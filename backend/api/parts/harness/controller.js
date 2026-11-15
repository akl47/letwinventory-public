const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');
const humanizeError = require('../../../util/humanizeError');
const harnessVcs = require('../../../services/vcs/harnessVcsService');
const { harnessSerialize, harnessDeserialize } = require('../../../services/vcs/harnessSerializer');
const vcsService = require('../../../services/vcs/vcsService');
const workflowEngine = require('../../../services/vcs/workflowEngine');
const cadDiffService = require('../../../services/vcs/cadDiffService');
const cadGraphService = require('../../../services/vcs/cadGraphService');
const { sendCadError } = require('../../../services/cadErrors');

const PART_INCLUDE = [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }];

// Harness JSON plus the version-control flags the editor reads — the same
// fields the CAD model endpoints return (released / displayRevision /
// draftRevision / behindMain).
async function present(harness) {
  const json = harness.toJSON();
  json.partNumber = json.Part ? json.Part.name : null;
  const onMain = (harness.branchName || 'main') === 'main';
  const tags = await vcsService.listRefs(await harnessVcs.repoFor(harness), 'tag');
  json.released = onMain && tags.length > 0;
  json.displayRevision = harness.revision;
  json.draftRevision = onMain ? null : harness.revision;
  json.behindMain = await harnessVcs.behindMain(harness);
  if (harness.lockedByUserID) {
    const holder = await db.User.findByPk(harness.lockedByUserID, { attributes: ['id', 'displayName'] });
    json.lockedBy = holder ? { id: holder.id, displayName: holder.displayName } : null;
  }
  return json;
}

// Load a harness and make sure it has a repository (adopting harnesses from
// before version control on first access — REQ 1066).
async function fetchHarness(req) {
  const harness = await db.WireHarness.findOne({ where: { id: req.params.id, activeFlag: true }, include: PART_INCLUDE });
  if (!harness) return null;
  await harnessVcs.ensureRepo(harness, req.user.id);
  return harness;
}

// Review workflow state is tracked per branch, as for CAD models.
async function workflowRepo(harness) {
  const repo = await harnessVcs.repoFor(harness);
  return { repoType: repo.repoType, repoId: `${repo.repoId}:${harness.branchName || 'main'}` };
}

// Helper: Check if adding childId as sub-harness of parentId would create a cycle
async function wouldCreateCycle(parentId, childId, visited = new Set()) {
  if (parentId === childId) return true;
  if (visited.has(childId)) return false;
  visited.add(childId);

  // Get the child harness and check its sub-harnesses
  const child = await db.WireHarness.findByPk(childId, {
    attributes: ['id', 'harnessData']
  });

  if (!child || !child.harnessData?.subHarnesses) return false;

  for (const subRef of child.harnessData.subHarnesses) {
    if (subRef.harnessId === parentId) return true;
    if (await wouldCreateCycle(parentId, subRef.harnessId, visited)) return true;
  }

  return false;
}

// Helper: Find all harnesses that reference a given harness as a sub-harness
async function findParentHarnesses(harnessId) {
  const allHarnesses = await db.WireHarness.findAll({
    where: { activeFlag: true },
    attributes: ['id', 'name', 'harnessData']
  });

  return allHarnesses.filter(h => {
    const subHarnesses = h.harnessData?.subHarnesses || [];
    return subHarnesses.some(sub => sub.harnessId === harnessId);
  });
}

// Get all harnesses (paginated, with basic info)
exports.getAllHarnesses = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, includeInactive = false } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const { count, rows } = await db.WireHarness.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'partID', 'revision', 'description', 'thumbnailBase64', 'activeFlag', 'createdBy', 'releaseState', 'releasedAt', 'releasedBy', 'branchName', 'lockedByUserID', 'createdAt', 'updatedAt'],
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name', 'commonPart'],
        // REQ 1071 — the CAD landing page filters by project.
        include: [{ model: db.Project, as: 'projects', attributes: ['id'], through: { attributes: [] } }]
      }],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform rows to include partNumber from Part
    const harnesses = rows.map(h => {
      const harness = h.toJSON();
      harness.partNumber = harness.Part ? harness.Part.name : null;
      harness.commonPart = !!(harness.Part && harness.Part.commonPart);
      harness.projectIDs = harness.Part ? (harness.Part.projects || []).map(p => p.id) : [];
      return harness;
    });

    res.json({
      harnesses,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(humanizeError(error, 'Error Getting Harnesses'));
  }
};

// Get single harness with full data
exports.getHarnessById = async (req, res, next) => {
  try {
    const harness = await fetchHarness(req);
    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }
    res.json(await present(harness));
  } catch (error) {
    next(humanizeError(error, 'Error Getting Harness'));
  }
};

// The harness to open for a part: the most recently updated one when several
// harness records share the part (the editor URL is keyed by part, like CAD).
exports.getActiveByPart = async (req, res, next) => {
  try {
    const latest = await db.WireHarness.findOne({
      where: { partID: req.params.partID, activeFlag: true },
      attributes: ['id'],
      order: [['updatedAt', 'DESC']]
    });
    if (!latest) return next(createError(404, 'This part has no harness'));
    req.params.id = latest.id;
    const harness = await fetchHarness(req);
    res.json(await present(harness));
  } catch (error) {
    next(humanizeError(error, 'Error Getting Harness'));
  }
};

// Get next available internal part number
exports.getNextPartNumber = async (req, res, next) => {
  try {
    // Find the highest part ID
    const maxPart = await db.Part.findOne({
      order: [['id', 'DESC']],
      attributes: ['id']
    });

    const nextId = (maxPart ? maxPart.id : 0) + 1;
    const partNumber = `LET-${String(nextId).padStart(4, '0')}`;

    res.json({ partNumber, nextId });
  } catch (error) {
    next(humanizeError(error, 'Error getting next part number'));
  }
};

// Create new harness
exports.createHarness = async (req, res, next) => {
  try {
    const { name, revision, description, harnessData, thumbnailBase64, createPart, partID } = req.body;

    if (!name) {
      return next(createError(400, 'Name is required'));
    }

    let createdPart = null;
    let linkedPartId = partID || null;

    // If createPart is true, create an internal Part with category "Harness"
    if (createPart && !partID) {
      // Find the Harness category
      const harnessCategory = await db.PartCategory.findOne({
        where: { name: 'Harness', activeFlag: true }
      });

      if (!harnessCategory) {
        return next(createError(400, 'Harness category not found. Please create it first.'));
      }

      // Create the Part
      createdPart = await db.Part.create({
        name: name,
        description: description || null,
        internalPart: true,
        partCategoryID: harnessCategory.id,
        minimumOrderQuantity: 1,
        activeFlag: true,
        serialNumberRequired: false,
        lotNumberRequired: false
      });

      linkedPartId = createdPart.id;
    }

    const harness = await db.WireHarness.create({
      name,
      revision: revision || '01',
      description: description || null,
      harnessData: harnessData || {},
      thumbnailBase64: thumbnailBase64 || null,
      createdBy: req.user ? req.user.displayName : null,
      createdByUserID: req.user ? req.user.id : null,
      partID: linkedPartId,
      releaseState: 'draft'
    });
    // Seed the repository: an empty `main` plus the first draft branch.
    await harnessVcs.ensureRepo(harness, req.user.id);

    // Log creation in history
    await db.HarnessRevisionHistory.create({
      harnessID: harness.id,
      revision: harness.revision,
      releaseState: harness.releaseState,
      changedBy: req.user ? req.user.displayName : null,
      changeType: 'created',
      createdAt: new Date()
    });

    const created = await db.WireHarness.findByPk(harness.id, { include: PART_INCLUDE });
    res.status(201).json(await present(created));
  } catch (error) {
    next(humanizeError(error, 'Error Creating Harness'));
  }
};

// Save the working copy. Content (name / description / harnessData) may only
// be saved by the user holding an unexpired checkout on a draft branch; the
// list thumbnail is a view artifact and needs no checkout.
exports.updateHarness = async (req, res) => {
  try {
    const { name, description, harnessData, thumbnailBase64, clientSavedAt } = req.body || {};
    const harness = await fetchHarness(req);
    if (!harness) return res.status(404).json({ error: 'Harness not found' });

    const patch = {};
    if (thumbnailBase64 !== undefined) patch.thumbnailBase64 = thumbnailBase64;
    const hasContent = name !== undefined || description !== undefined || harnessData !== undefined;
    if (hasContent) {
      if ((harness.branchName || 'main') === 'main') {
        return res.status(423).json({ error: 'The main branch is protected — create or switch to a draft branch to make changes' });
      }
      if (harness.lockedByUserID !== req.user.id) {
        if (harness.lockedByUserID) {
          const holder = await db.User.findByPk(harness.lockedByUserID);
          return res.status(423).json({ error: `Harness "${harness.name}" is checked out by ${holder ? holder.displayName : 'another user'}` });
        }
        return res.status(423).json({ error: `Check out harness "${harness.name}" before editing it` });
      }
      if (harness.lockExpiresAt && new Date() > new Date(harness.lockExpiresAt)) {
        return res.status(423).json({ error: `Your checkout of harness "${harness.name}" has expired — check out again to continue`, code: 'LOCK_EXPIRED' });
      }
      // Two sessions of the same user both hold the lock; the save token stops
      // one silently overwriting the other.
      if (clientSavedAt !== undefined) {
        const serverTok = harness.lastContentSavedAt ? new Date(harness.lastContentSavedAt).getTime() : null;
        const clientTok = clientSavedAt ? new Date(clientSavedAt).getTime() : null;
        if (serverTok !== clientTok) {
          return res.status(409).json({
            error: 'This harness was changed by another session since this window last saved — reload to continue from the latest state.',
            code: 'DOC_CONFLICT',
          });
        }
      }
      if (name !== undefined) patch.name = name;
      if (description !== undefined) patch.description = description;
      if (harnessData !== undefined) patch.harnessData = harnessData;
      patch.dirty = true;
      patch.lastContentSavedAt = new Date();
      // A successful save slides the lock expiry forward.
      patch.lockExpiresAt = new Date(Date.now() + harnessVcs.DEFAULT_LOCK_TTL_MS);
    }
    await harness.update(patch);
    return res.json(await present(harness));
  } catch (err) {
    return sendCadError(res, err, 'Failed to save harness');
  }
};

// Soft delete harness
exports.deleteHarness = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);
    const harness = await db.WireHarness.findOne({
      where: {
        id: harnessId,
        activeFlag: true
      }
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    // Check if this harness is used as a sub-harness in any other harness
    const parentHarnesses = await findParentHarnesses(harnessId);
    if (parentHarnesses.length > 0) {
      const parentNames = parentHarnesses.map(h => h.name).join(', ');
      return next(createError(400, `Cannot delete harness: it is used as a sub-harness in: ${parentNames}`));
    }

    await db.WireHarness.update(
      { activeFlag: false },
      { where: { id: harnessId } }
    );

    res.json({ message: 'Harness deleted successfully' });
  } catch (error) {
    next(humanizeError(error, 'Error Deleting Harness'));
  }
};

// Validate JSON without saving
exports.validateHarness = async (req, res, next) => {
  try {
    const { harnessData, harnessId } = req.body;

    if (!harnessData) {
      return res.json({
        valid: false,
        errors: ['No harness data provided']
      });
    }

    const errors = [];

    // Validate name (at top level, not under metadata)
    if (!harnessData.name) {
      errors.push('Missing name field');
    }

    // Validate connectors array
    if (!Array.isArray(harnessData.connectors)) {
      errors.push('Connectors must be an array');
    } else {
      harnessData.connectors.forEach((conn, idx) => {
        if (!conn.id) errors.push(`Connector at index ${idx} missing id`);
        if (!conn.label) errors.push(`Connector at index ${idx} missing label`);
      });
    }

    // Validate cables array
    if (!Array.isArray(harnessData.cables)) {
      errors.push('Cables must be an array');
    } else {
      harnessData.cables.forEach((cable, idx) => {
        if (!cable.id) errors.push(`Cable at index ${idx} missing id`);
        if (!cable.label) errors.push(`Cable at index ${idx} missing label`);
      });
    }

    // Validate sub-harnesses array
    const subHarnessIds = new Set();
    if (harnessData.subHarnesses && Array.isArray(harnessData.subHarnesses)) {
      for (let idx = 0; idx < harnessData.subHarnesses.length; idx++) {
        const sub = harnessData.subHarnesses[idx];
        if (!sub.id) errors.push(`Sub-harness at index ${idx} missing id`);
        if (!sub.harnessId) errors.push(`Sub-harness at index ${idx} missing harnessId`);

        subHarnessIds.add(sub.id);

        // Verify referenced harness exists
        if (sub.harnessId) {
          const refHarness = await db.WireHarness.findByPk(sub.harnessId, {
            attributes: ['id', 'activeFlag']
          });
          if (!refHarness) {
            errors.push(`Sub-harness at index ${idx} references non-existent harness ID: ${sub.harnessId}`);
          } else if (!refHarness.activeFlag) {
            errors.push(`Sub-harness at index ${idx} references inactive harness ID: ${sub.harnessId}`);
          }

          // Check for cycles (only if we know the parent harness ID)
          if (harnessId && sub.harnessId) {
            const wouldCycle = await wouldCreateCycle(harnessId, sub.harnessId);
            if (wouldCycle) {
              errors.push(`Sub-harness at index ${idx} would create a circular reference`);
            }
          }
        }
      }
    }

    // Validate connections array
    if (!Array.isArray(harnessData.connections)) {
      errors.push('Connections must be an array');
    } else {
      const connectorIds = new Set((harnessData.connectors || []).map(c => c.id));
      const cableIds = new Set((harnessData.cables || []).map(c => c.id));
      const componentIds = new Set((harnessData.components || []).map(c => c.id));

      harnessData.connections.forEach((conn, idx) => {
        if (!conn.id) errors.push(`Connection at index ${idx} missing id`);

        const connectionType = conn.connectionType || 'wire';

        // Validate mating connections
        if (connectionType === 'mating') {
          // Mating connections must be between two connector pins (direct or via sub-harness)
          const hasFromConnectorEndpoint = !!conn.fromConnector || !!conn.fromSubConnector;
          const hasToConnectorEndpoint = !!conn.toConnector || !!conn.toSubConnector;
          if (!hasFromConnectorEndpoint || !hasToConnectorEndpoint) {
            errors.push(`Mating connection at index ${idx} must connect two connectors`);
          }
          if (conn.fromCable || conn.toCable || conn.fromComponent || conn.toComponent) {
            errors.push(`Mating connection at index ${idx} cannot involve cables or components`);
          }
        }

        // A connection must have a "from" endpoint
        const hasFromConnector = !!conn.fromConnector;
        const hasFromCable = !!conn.fromCable;
        const hasFromComponent = !!conn.fromComponent;
        const hasFromSubHarness = !!conn.fromSubHarness;
        if (!hasFromConnector && !hasFromCable && !hasFromComponent && !hasFromSubHarness) {
          errors.push(`Connection at index ${idx} missing from endpoint`);
        }

        // A connection must have a "to" endpoint
        const hasToConnector = !!conn.toConnector;
        const hasToCable = !!conn.toCable;
        const hasToComponent = !!conn.toComponent;
        const hasToSubHarness = !!conn.toSubHarness;
        if (!hasToConnector && !hasToCable && !hasToComponent && !hasToSubHarness) {
          errors.push(`Connection at index ${idx} missing to endpoint`);
        }

        // Validate referenced connectors exist
        if (conn.fromConnector && !connectorIds.has(conn.fromConnector)) {
          errors.push(`Connection at index ${idx} references non-existent fromConnector: ${conn.fromConnector}`);
        }
        if (conn.toConnector && !connectorIds.has(conn.toConnector)) {
          errors.push(`Connection at index ${idx} references non-existent toConnector: ${conn.toConnector}`);
        }

        // Validate referenced cables exist
        if (conn.fromCable && !cableIds.has(conn.fromCable)) {
          errors.push(`Connection at index ${idx} references non-existent fromCable: ${conn.fromCable}`);
        }
        if (conn.toCable && !cableIds.has(conn.toCable)) {
          errors.push(`Connection at index ${idx} references non-existent toCable: ${conn.toCable}`);
        }

        // Validate referenced components exist
        if (conn.fromComponent && !componentIds.has(conn.fromComponent)) {
          errors.push(`Connection at index ${idx} references non-existent fromComponent: ${conn.fromComponent}`);
        }
        if (conn.toComponent && !componentIds.has(conn.toComponent)) {
          errors.push(`Connection at index ${idx} references non-existent toComponent: ${conn.toComponent}`);
        }

        // Validate referenced sub-harnesses exist
        if (conn.fromSubHarness && !subHarnessIds.has(conn.fromSubHarness)) {
          errors.push(`Connection at index ${idx} references non-existent fromSubHarness: ${conn.fromSubHarness}`);
        }
        if (conn.toSubHarness && !subHarnessIds.has(conn.toSubHarness)) {
          errors.push(`Connection at index ${idx} references non-existent toSubHarness: ${conn.toSubHarness}`);
        }

        // Legacy: validate cable field if present
        if (conn.cable && !cableIds.has(conn.cable)) {
          errors.push(`Connection at index ${idx} references non-existent cable: ${conn.cable}`);
        }
      });
    }

    res.json({
      valid: errors.length === 0,
      errors
    });
  } catch (error) {
    next(humanizeError(error, 'Error Validating Harness'));
  }
};

// Batch fetch harness data for sub-harnesses
exports.getSubHarnessData = async (req, res, next) => {
  try {
    const { ids } = req.query;

    if (!ids) {
      return res.json([]);
    }

    const harnessIds = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (harnessIds.length === 0) {
      return res.json([]);
    }

    const harnesses = await db.WireHarness.findAll({
      where: {
        id: { [Op.in]: harnessIds },
        activeFlag: true
      },
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    const result = harnesses.map(h => {
      const harness = h.toJSON();
      harness.partNumber = harness.Part ? harness.Part.name : null;
      return harness;
    });

    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Error fetching sub-harness data'));
  }
};

// Get harnesses that contain this one as a sub-harness
exports.getParentHarnesses = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);
    const parentHarnesses = await findParentHarnesses(harnessId);

    const result = parentHarnesses.map(h => ({
      id: h.id,
      name: h.name
    }));

    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Error fetching parent harnesses'));
  }
};

// ========== Version control (REQ 1062–1066) ==========
// The CAD workflow, in the harness backend: exclusive checkout, check-in,
// draft branches off a protected main, release to a numeric revision, and an
// approval-gated production (letter) release.

// Helper to log history entry
async function logHistory(harness, changeType, changedBy, notes = null) {
  await db.HarnessRevisionHistory.create({
    harnessID: harness.id,
    revision: harness.revision,
    releaseState: harness.releaseState,
    changedBy,
    changeType,
    changeNotes: notes,
    createdAt: new Date()
  });
}

// Wrap a handler: load + adopt the harness, 404 when missing, uniform errors.
const withHarness = (fallback, fn) => async (req, res) => {
  try {
    const harness = await fetchHarness(req);
    if (!harness) return res.status(404).json({ error: 'Harness not found' });
    return await fn(harness, req, res);
  } catch (err) {
    return sendCadError(res, err, fallback);
  }
};

exports.checkout = withHarness('Failed to check out harness', async (harness, req, res) => {
  if ((harness.branchName || 'main') === 'main') {
    return res.status(423).json({ error: 'The main branch is protected — create or switch to a draft branch to make changes' });
  }
  const { stashedTo } = await harnessVcs.checkout(harness, req.user.id, { takeover: !!(req.body && req.body.takeover === true) });
  const json = await present(harness);
  return res.json(stashedTo ? { ...json, stashedTo } : json);
});

exports.renewLock = withHarness('Failed to renew the harness checkout', async (harness, req, res) => {
  await harnessVcs.renewLock(harness, req.user.id, {});
  return res.json({ lockExpiresAt: harness.lockExpiresAt });
});

exports.checkin = withHarness('Failed to check in harness', async (harness, req, res) => {
  const message = (req.body && req.body.message) || '';
  const keepCheckedOut = !!(req.body && req.body.keepCheckedOut);
  const { commitHash } = await harnessVcs.checkin(harness, req.user.id, message);
  if (keepCheckedOut) {
    try { await harnessVcs.renewLock(harness, req.user.id, {}); }
    catch { await harnessVcs.releaseLock(harness, req.user.id); }
  } else {
    await harnessVcs.releaseLock(harness, req.user.id);
  }
  return res.json({ commitHash, model: await present(harness) });
});

exports.undoCheckout = withHarness('Failed to undo the harness checkout', async (harness, req, res) => {
  await harnessVcs.undoCheckout(harness, req.user.id);
  return res.json(await present(harness));
});

exports.forceUnlock = withHarness('Failed to unlock harness', async (harness, req, res) => {
  await harnessVcs.releaseLock(harness, req.user.id, { force: true });
  return res.json(await present(harness));
});

exports.getCommits = withHarness('Failed to fetch harness commit log', async (harness, req, res) =>
  res.json(await harnessVcs.history(harness)));

exports.getGraph = withHarness('Failed to build harness version graph', async (harness, req, res) =>
  res.json(await cadGraphService.buildGraphForRepo(await harnessVcs.repoFor(harness), harness.baseCommitHash, db)));

exports.getWorkingDiff = withHarness('Failed to diff harness', async (harness, req, res) =>
  res.json(await cadDiffService.workingDiff(harness, undefined, {
    repoFor: harnessVcs.repoFor, serialize: harnessSerialize, docOf: harnessVcs.docOf,
  })));

exports.getCommitDiff = withHarness('Failed to diff harness commits', async (harness, req, res) =>
  res.json(await cadDiffService.commitDiff(await harnessVcs.repoFor(harness), req.params.a, req.params.b)));

exports.getCommitDoc = withHarness('Failed to load harness commit', async (harness, req, res) => {
  const repo = await harnessVcs.repoFor(harness);
  const commit = await vcsService.getCommit(repo, req.params.hash, db);
  if (!commit) return res.status(404).json({ error: `Commit ${req.params.hash} not found` });
  const doc = await harnessDeserialize(repo, commit.treeHash, db);
  return res.json({ ...doc, hash: req.params.hash, message: commit.message || null });
});

exports.listBranches = withHarness('Failed to list harness branches', async (harness, req, res) =>
  res.json(await harnessVcs.listBranches(harness)));

exports.createBranch = withHarness('Failed to create harness branch', async (harness, req, res) => {
  const { name, fromCommit } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Branch name is required' });
  return res.json(await harnessVcs.createBranch(harness, name, { fromCommit }, req.user.id));
});

exports.switchBranch = withHarness('Failed to switch harness branch', async (harness, req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Branch name is required' });
  if (harness.lockedByUserID && harness.lockedByUserID !== req.user.id) {
    return res.status(423).json({ error: 'This harness is checked out by another user' });
  }
  await harnessVcs.switchBranch(harness, name, req.user.id);
  return res.json(await present(harness));
});

exports.archiveBranch = withHarness('Failed to archive harness branch', async (harness, req, res) =>
  res.json(await harnessVcs.archiveBranch(harness, req.params.name)));

exports.getWorkflow = withHarness('Failed to load harness workflow', async (harness, req, res) => {
  const repo = await workflowRepo(harness);
  return res.json({
    state: await workflowEngine.getState(repo),
    actions: await workflowEngine.availableActions(repo, req.user.id, undefined, req._effectivePermissions),
  });
});

// The route is read-gated; the engine enforces each transition's own permission.
exports.transitionWorkflow = withHarness('Failed to update harness workflow', async (harness, req, res) => {
  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });
  const repo = await workflowRepo(harness);
  const r = await workflowEngine.transition(repo, action, req.user.id, {
    authorUserID: harness.createdByUserID,
    permissions: req._effectivePermissions,
    commitHash: harness.baseCommitHash || null,
    modelName: harness.name,
  });
  return res.json({
    state: r.state,
    actions: await workflowEngine.availableActions(repo, req.user.id, undefined, req._effectivePermissions),
    model: await present(harness),
  });
});

// Release the checked-in draft branch onto main as the next numeric revision.
exports.releaseHarness = withHarness('Failed to release harness', async (harness, req, res) => {
  if ((harness.branchName || 'main') === 'main') {
    return res.status(409).json({ error: 'This revision is already released — create a draft branch to make changes, then release it' });
  }
  // A released harness must not depend on unreleased sub-harness content.
  const unreleased = [];
  for (const ref of harness.harnessData?.subHarnesses || []) {
    const sub = await db.WireHarness.findByPk(ref.harnessId, { attributes: ['id', 'name', 'releaseState'] });
    if (sub && sub.releaseState !== 'released') unreleased.push(sub.name);
  }
  if (unreleased.length) {
    return res.status(409).json({ error: `Release the sub-harnesses first: ${[...new Set(unreleased)].join(', ')}` });
  }
  const draftWorkflow = await workflowRepo(harness);
  const released = await harnessVcs.releaseBranchToMain(harness, req.user);
  await workflowEngine.setState(draftWorkflow, 'draft', req.user.id);
  await workflowEngine.setState(await workflowRepo(harness), 'draft', req.user.id);
  await logHistory(harness, 'released', req.user.displayName, `Released as revision ${released.tag}`);
  return res.json({ commitHash: released.commitHash, revision: released.tag, model: await present(harness) });
});

// Production release: tag the released commit with the next letter revision.
// Requires a workflow approval of that exact commit.
exports.productionRelease = withHarness('Failed to create production release', async (harness, req, res) => {
  if ((harness.branchName || 'main') !== 'main' || !harness.releaseLocked) {
    return res.status(409).json({ error: 'Release the harness before promoting it to production' });
  }
  if (!/^\d+$/.test(harness.revision)) {
    return res.status(409).json({ error: `Revision ${harness.revision} is already a production release` });
  }
  const repo = await harnessVcs.repoFor(harness);
  const releaseRef = await vcsService.getRef(repo, String(harness.revision));
  if (!releaseRef) return res.status(409).json({ error: 'Release tag not found for this revision' });
  const wf = await workflowRepo(harness);
  if (!(await workflowEngine.canRelease(wf, undefined, releaseRef.targetHash))) {
    return res.status(409).json({ error: `Production release requires a workflow approval of revision ${harness.revision}` });
  }
  const sourceRevision = harness.revision;
  const revision = await harnessVcs.nextProductionRevision(harness);
  await vcsService.createTag(repo, revision, releaseRef.targetHash, req.user.id);
  await harness.update({ revision, releasedAt: new Date(), releasedBy: req.user.displayName || null });
  await workflowEngine.setState(wf, 'draft', req.user.id);
  await logHistory(harness, 'production_release', req.user.displayName, `Production release created from revision ${sourceRevision}`);
  return res.json({ revision, sourceRevision, model: await present(harness) });
});

// Get revision history for a harness
exports.getHistory = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);

    const history = await db.HarnessRevisionHistory.findAll({
      where: { harnessID: harnessId },
      order: [['createdAt', 'DESC']]
    });

    res.json(history);
  } catch (error) {
    next(humanizeError(error, 'Error fetching history'));
  }
};

// Get all revisions of a harness (follows previousRevisionID chain)
exports.getAllRevisions = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);

    // First, find the root revision (no previousRevisionID)
    let current = await db.WireHarness.findByPk(harnessId);
    if (!current) {
      return next(createError(404, 'Harness not found'));
    }

    // Walk back to find root
    while (current.previousRevisionID) {
      current = await db.WireHarness.findByPk(current.previousRevisionID);
      if (!current) break;
    }

    // Now collect all revisions forward
    const revisions = [];
    const collectRevisions = async (harness) => {
      const h = harness.toJSON();
      const part = await db.Part.findByPk(h.partID);
      h.partNumber = part ? part.name : null;
      revisions.push(h);

      // Find next revisions
      const nextRevs = await db.WireHarness.findAll({
        where: { previousRevisionID: harness.id }
      });
      for (const next of nextRevs) {
        await collectRevisions(next);
      }
    };

    if (current) {
      await collectRevisions(current);
    }

    // Sort by revision letter
    revisions.sort((a, b) => a.revision.localeCompare(b.revision));

    res.json(revisions);
  } catch (error) {
    next(humanizeError(error, 'Error fetching revisions'));
  }
};
