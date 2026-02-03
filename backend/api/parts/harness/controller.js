const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');

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

// Helper: Cascade release state to all sub-harnesses
async function cascadeReleaseState(harness, newState, changedBy) {
  const subHarnesses = harness.harnessData?.subHarnesses || [];
  if (subHarnesses.length === 0) return [];

  const updatedSubHarnesses = [];

  for (const subRef of subHarnesses) {
    const subHarness = await db.WireHarness.findByPk(subRef.harnessId);
    if (!subHarness) continue;

    // Only update if not already at or past the target state
    const stateOrder = { draft: 0, review: 1, released: 2 };
    if (stateOrder[subHarness.releaseState] >= stateOrder[newState]) continue;

    const updateData = { releaseState: newState };
    if (newState === 'released') {
      updateData.releasedAt = new Date();
      updateData.releasedBy = changedBy;
    }

    await subHarness.update(updateData);

    // Log history for the sub-harness
    const changeType = newState === 'review' ? 'submitted_review' : 'released';
    await logHistory(subHarness.id, changeType, changedBy, `Cascaded from parent harness: ${harness.name}`);

    updatedSubHarnesses.push({
      id: subHarness.id,
      name: subHarness.name,
      previousState: subHarness.releaseState,
      newState: newState
    });

    // Recursively cascade to nested sub-harnesses
    const nestedUpdates = await cascadeReleaseState(subHarness, newState, changedBy);
    updatedSubHarnesses.push(...nestedUpdates);
  }

  return updatedSubHarnesses;
}

// Get all harnesses (paginated, with basic info)
exports.getAllHarnesses = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, includeInactive = false } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const { count, rows } = await db.WireHarness.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'partID', 'revision', 'description', 'thumbnailBase64', 'activeFlag', 'createdBy', 'releaseState', 'releasedAt', 'releasedBy', 'createdAt', 'updatedAt'],
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform rows to include partNumber from Part
    const harnesses = rows.map(h => {
      const harness = h.toJSON();
      harness.partNumber = harness.Part ? harness.Part.name : null;
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
    next(createError(500, 'Error Getting Harnesses: ' + error.message));
  }
};

// Get single harness with full data
exports.getHarnessById = async (req, res, next) => {
  try {
    const harness = await db.WireHarness.findOne({
      where: {
        id: req.params.id
      },
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    // Add partNumber from Part
    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Getting Harness: ' + error.message));
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
    next(createError(500, 'Error getting next part number: ' + error.message));
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
      partID: linkedPartId,
      releaseState: 'draft'
    });

    // Log creation in history
    await db.HarnessRevisionHistory.create({
      harnessID: harness.id,
      revision: harness.revision,
      releaseState: harness.releaseState,
      changedBy: req.user ? req.user.displayName : null,
      changeType: 'created',
      createdAt: new Date()
    });

    // Return with computed partNumber from Part name
    const result = harness.toJSON();
    if (linkedPartId) {
      const linkedPart = createdPart || await db.Part.findByPk(linkedPartId);
      result.partNumber = linkedPart ? linkedPart.name : null;
    } else {
      result.partNumber = null;
    }

    res.status(201).json(result);
  } catch (error) {
    next(createError(500, 'Error Creating Harness: ' + error.message));
  }
};

// Update harness
exports.updateHarness = async (req, res, next) => {
  try {
    const { name, revision, description, harnessData, thumbnailBase64, forceNewRevision } = req.body;

    const harness = await db.WireHarness.findOne({
      where: { id: req.params.id },
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    const changedBy = req.user ? req.user.displayName : null;

    // If harness is released, create a new revision instead of modifying
    if (harness.releaseState === 'released' || forceNewRevision) {
      const nextRev = getNextRevision(harness.revision);

      const newHarness = await db.WireHarness.create({
        name: name !== undefined ? name : harness.name,
        revision: nextRev,
        description: description !== undefined ? description : harness.description,
        harnessData: harnessData !== undefined ? harnessData : harness.harnessData,
        thumbnailBase64: thumbnailBase64 !== undefined ? thumbnailBase64 : harness.thumbnailBase64,
        createdBy: changedBy,
        partID: harness.partID,
        releaseState: 'draft',
        previousRevisionID: harness.id
      });

      // Log new revision creation
      await db.HarnessRevisionHistory.create({
        harnessID: newHarness.id,
        revision: newHarness.revision,
        releaseState: newHarness.releaseState,
        changedBy,
        changeType: 'new_revision',
        changeNotes: `Created from revision ${harness.revision}`,
        createdAt: new Date()
      });

      const result = newHarness.toJSON();
      result.partNumber = harness.Part ? harness.Part.name : null;
      result.isNewRevision = true;

      return res.json(result);
    }

    // Normal update for draft/review harnesses
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (revision !== undefined) updateData.revision = revision;
    if (description !== undefined) updateData.description = description;
    if (harnessData !== undefined) updateData.harnessData = harnessData;
    if (thumbnailBase64 !== undefined) updateData.thumbnailBase64 = thumbnailBase64;

    await db.WireHarness.update(updateData, {
      where: { id: req.params.id }
    });

    // Log update
    await db.HarnessRevisionHistory.create({
      harnessID: harness.id,
      revision: harness.revision,
      releaseState: harness.releaseState,
      changedBy,
      changeType: 'updated',
      snapshotData: harnessData || null,
      createdAt: new Date()
    });

    const updatedHarness = await db.WireHarness.findByPk(req.params.id, {
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    // Return with computed partNumber
    const result = updatedHarness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Updating Harness: ' + error.message));
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
    next(createError(500, 'Error Deleting Harness: ' + error.message));
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
    next(createError(500, 'Error Validating Harness: ' + error.message));
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
    next(createError(500, 'Error fetching sub-harness data: ' + error.message));
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
    next(createError(500, 'Error fetching parent harnesses: ' + error.message));
  }
};

// ========== Revision Control Endpoints ==========

// Helper to check if a revision is numeric (00, 01, 02, etc.)
function isNumericRevision(revision) {
  return /^\d+$/.test(revision);
}

// Helper to check if a revision is alphabetic (A, B, C, etc.)
function isLetterRevision(revision) {
  return /^[A-Z]+$/.test(revision);
}

// Helper to get next numeric revision (00 -> 01 -> 02 -> ... -> 99 -> 100)
function getNextNumericRevision(current) {
  if (!current || !isNumericRevision(current)) return '01';
  const num = parseInt(current, 10) + 1;
  return num.toString().padStart(2, '0');
}

// Helper to get next letter revision (A -> B -> C -> ... -> Z -> AA -> AB)
function getNextLetterRevision(current) {
  if (!current || !isLetterRevision(current)) return 'A';
  const chars = current.toUpperCase().split('');
  let i = chars.length - 1;

  while (i >= 0) {
    if (chars[i] === 'Z') {
      chars[i] = 'A';
      i--;
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
  }
  // All were Z, need to add a new character
  return 'A' + chars.join('');
}

// Helper to find the latest revision of a given type for a harness family
async function getLatestRevisionOfType(partID, type) {
  const where = { partID, activeFlag: true };
  const harnesses = await db.WireHarness.findAll({
    where,
    attributes: ['revision'],
    order: [['createdAt', 'DESC']]
  });

  for (const h of harnesses) {
    if (type === 'numeric' && isNumericRevision(h.revision)) {
      return h.revision;
    }
    if (type === 'letter' && isLetterRevision(h.revision)) {
      return h.revision;
    }
  }
  return null;
}

// Legacy helper for backward compatibility
function getNextRevision(current) {
  return getNextNumericRevision(current);
}

// Helper to log history entry
async function logHistory(harnessId, changeType, changedBy, notes = null, snapshotData = null) {
  const harness = await db.WireHarness.findByPk(harnessId);
  if (!harness) return;

  // Don't log history for released harnesses (except for the 'released' event itself)
  if (harness.releaseState === 'released' && changeType !== 'released') return;

  await db.HarnessRevisionHistory.create({
    harnessID: harnessId,
    revision: harness.revision,
    releaseState: harness.releaseState,
    changedBy,
    changeType,
    changeNotes: notes,
    snapshotData,
    createdAt: new Date()
  });
}

// Submit harness for review (draft -> review)
exports.submitForReview = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);
    const harness = await db.WireHarness.findByPk(harnessId, {
      include: [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    if (harness.releaseState !== 'draft') {
      return next(createError(400, 'Harness must be in draft state to submit for review'));
    }

    const changedBy = req.user ? req.user.displayName : null;

    // Cascade to sub-harnesses first
    const updatedSubHarnesses = await cascadeReleaseState(harness, 'review', changedBy);

    await harness.update({ releaseState: 'review' });
    await logHistory(harnessId, 'submitted_review', changedBy);

    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;
    result.updatedSubHarnesses = updatedSubHarnesses;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error submitting for review: ' + error.message));
  }
};

// Reject harness back to draft (review -> draft)
exports.rejectHarness = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);
    const { notes } = req.body;

    const harness = await db.WireHarness.findByPk(harnessId, {
      include: [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    if (harness.releaseState !== 'review') {
      return next(createError(400, 'Harness must be in review state to reject'));
    }

    await harness.update({ releaseState: 'draft' });

    const changedBy = req.user ? req.user.displayName : null;
    await logHistory(harnessId, 'rejected', changedBy, notes);

    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error rejecting harness: ' + error.message));
  }
};

// Release harness (review -> released) - keeps the same revision number
exports.releaseHarness = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);

    const harness = await db.WireHarness.findByPk(harnessId, {
      include: [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    if (harness.releaseState !== 'review') {
      return next(createError(400, 'Harness must be in review state to release'));
    }

    const changedBy = req.user ? req.user.displayName : null;
    const now = new Date();

    // Cascade to sub-harnesses first
    const updatedSubHarnesses = await cascadeReleaseState(harness, 'released', changedBy);

    await harness.update({
      releaseState: 'released',
      releasedAt: now,
      releasedBy: changedBy
    });

    // Log with snapshot
    await logHistory(harnessId, 'released', changedBy, `Released as revision ${harness.revision}`, harness.harnessData);

    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;
    result.updatedSubHarnesses = updatedSubHarnesses;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error releasing harness: ' + error.message));
  }
};

// Release production revision (creates a letter revision from a released numeric revision)
exports.releaseProduction = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);

    const harness = await db.WireHarness.findByPk(harnessId, {
      include: [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    if (harness.releaseState !== 'released') {
      return next(createError(400, 'Harness must be released before creating a production revision'));
    }

    if (!isNumericRevision(harness.revision)) {
      return next(createError(400, 'Harness must have a numeric revision to create a production release'));
    }

    const changedBy = req.user ? req.user.displayName : null;
    const now = new Date();

    // Calculate the next letter revision
    const latestLetter = await getLatestRevisionOfType(harness.partID, 'letter');
    const nextRevision = getNextLetterRevision(latestLetter);

    // Create a new harness record with the production revision
    const newHarness = await db.WireHarness.create({
      name: harness.name,
      revision: nextRevision,
      description: harness.description,
      harnessData: harness.harnessData,
      thumbnailBase64: harness.thumbnailBase64,
      createdBy: changedBy,
      partID: harness.partID,
      releaseState: 'released',
      releasedAt: now,
      releasedBy: changedBy,
      previousRevisionID: harness.id
    });

    // Log history for the new production revision
    await db.HarnessRevisionHistory.create({
      harnessID: newHarness.id,
      revision: newHarness.revision,
      releaseState: newHarness.releaseState,
      changedBy,
      changeType: 'production_release',
      changeNotes: `Production release created from revision ${harness.revision}`,
      snapshotData: newHarness.harnessData,
      createdAt: now
    });

    const result = newHarness.toJSON();
    result.partNumber = harness.Part ? harness.Part.name : null;
    result.sourceRevision = harness.revision;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error creating production release: ' + error.message));
  }
};

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
    next(createError(500, 'Error fetching history: ' + error.message));
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
    next(createError(500, 'Error fetching revisions: ' + error.message));
  }
};

// Revert to a history snapshot
exports.revertToSnapshot = async (req, res, next) => {
  try {
    const harnessId = parseInt(req.params.id);
    const historyId = parseInt(req.params.historyId);

    const harness = await db.WireHarness.findByPk(harnessId, {
      include: [{ model: db.Part, as: 'Part', attributes: ['id', 'name'] }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    if (harness.releaseState === 'released') {
      return next(createError(400, 'Cannot revert a released harness. Create a new revision first.'));
    }

    const historyEntry = await db.HarnessRevisionHistory.findOne({
      where: { id: historyId, harnessID: harnessId }
    });

    if (!historyEntry) {
      return next(createError(404, 'History entry not found'));
    }

    if (!historyEntry.snapshotData) {
      return next(createError(400, 'This history entry does not have snapshot data'));
    }

    await harness.update({ harnessData: historyEntry.snapshotData });

    const changedBy = req.user ? req.user.displayName : null;
    await logHistory(harnessId, 'updated', changedBy, `Reverted to snapshot from ${historyEntry.createdAt}`);

    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error reverting to snapshot: ' + error.message));
  }
};
