const db = require('../../../models');
const {
  syncFeatureFromGitHub,
  parseRepoString,
  parsePrURL,
  listBranches,
  listBranchCommits,
} = require('../../../services/githubSync');

const TRACKED_FIELDS = [
  'name', 'slug', 'description', 'markdownBody', 'projectID',
  'reviewerUserID', 'branchName', 'prURL', 'githubRepo', 'commitRefs',
];

function getConfiguredRepos() {
  const raw = (process.env.GITHUB_REPOS || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean)
    .map(s => parseRepoString(s)).filter(Boolean);
}

const featureIncludes = [
  { model: db.User, as: 'owner', attributes: ['id', 'displayName', 'email', 'photoURL'] },
  { model: db.User, as: 'reviewer', attributes: ['id', 'displayName', 'email', 'photoURL'] },
  { model: db.User, as: 'approvedBy', attributes: ['id', 'displayName', 'email', 'photoURL'] },
  { model: db.User, as: 'releasedBy', attributes: ['id', 'displayName', 'email', 'photoURL'] },
  { model: db.Project, as: 'project', attributes: ['id', 'name', 'shortName', 'tagColorHex'] },
];

async function recordHistory(designFeatureID, changedByUserID, changeType, changes, changeNotes) {
  await db.DesignFeatureHistory.create({
    designFeatureID, changedByUserID, changeType,
    changes: changes || null,
    changeNotes: changeNotes || null,
    createdAt: new Date(),
  });
}

function validateCommitRefs(commitRefs) {
  if (commitRefs == null) return null;
  if (!Array.isArray(commitRefs)) {
    return 'commitRefs must be an array';
  }
  for (const c of commitRefs) {
    if (!c || typeof c !== 'object') return 'commitRefs entries must be objects';
    if (!c.sha || typeof c.sha !== 'string') return 'commitRefs entries must include a sha string';
  }
  return null;
}

function handleError(res, error, fallbackStatus = 400) {
  if (error.name === 'SequelizeUniqueConstraintError') {
    const slugErr = (error.errors || []).find(e => e.path && e.path.toLowerCase().includes('slug'));
    if (slugErr) {
      return res.status(400).json({
        error: `A Feature with slug '${slugErr.value}' already exists`,
      });
    }
    return res.status(400).json({ error: 'A record with these values already exists' });
  }
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: `Referenced record not found: ${error.fields ? Object.keys(error.fields).join(', ') : 'unknown field'}`,
    });
  }
  if (error.name === 'SequelizeValidationError') {
    return res.status(400).json({ error: error.errors.map(e => e.message).join('; ') });
  }
  return res.status(fallbackStatus).json({ error: error.message });
}

exports.create = async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: 'name is required' });
    if (!req.body.slug) return res.status(400).json({ error: 'slug is required' });
    if (!req.body.projectID) return res.status(400).json({ error: 'projectID is required' });

    const commitErr = validateCommitRefs(req.body.commitRefs);
    if (commitErr) return res.status(400).json({ error: commitErr });

    // Manual active-slug check (in addition to the partial unique index) so we
    // get the same human error on both PG and SQLite.
    const existing = await db.DesignFeature.findOne({
      where: { slug: req.body.slug, activeFlag: true },
    });
    if (existing) {
      return res.status(400).json({
        error: `A Feature with slug '${req.body.slug}' already exists`,
      });
    }

    const feature = await db.DesignFeature.create({
      ...req.body,
      ownerUserID: req.user.id,
      reviewState: 'draft',
    });

    const changes = {};
    for (const field of TRACKED_FIELDS) {
      if (feature[field] != null) {
        changes[field] = { from: null, to: feature[field] };
      }
    }
    await recordHistory(feature.id, req.user.id, 'created', changes);

    res.status(201).json(feature);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getAll = async (req, res) => {
  try {
    const where = { activeFlag: true };
    if (req.query.projectID) where.projectID = req.query.projectID;
    if (req.query.reviewState) where.reviewState = req.query.reviewState;
    if (req.query.ownerUserID) where.ownerUserID = req.query.ownerUserID;

    const features = await db.DesignFeature.findAll({
      where,
      include: featureIncludes,
      order: [['updatedAt', 'DESC']],
    });

    // Annotate each row with a requirementCount.
    const ids = features.map(f => f.id);
    const counts = ids.length ? await db.DesignRequirement.findAll({
      where: { designFeatureID: ids, activeFlag: true },
      attributes: [
        'designFeatureID',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
      ],
      group: ['designFeatureID'],
      raw: true,
    }) : [];
    const countMap = {};
    for (const row of counts) countMap[row.designFeatureID] = parseInt(row.count, 10);

    const result = features.map(f => {
      const json = f.toJSON();
      json.requirementCount = countMap[f.id] || 0;
      return json;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const feature = await db.DesignFeature.findByPk(req.params.id, {
      include: [
        ...featureIncludes,
        {
          model: db.DesignRequirement,
          as: 'requirements',
          where: { activeFlag: true },
          required: false,
          attributes: ['id', 'description', 'approvalStatus', 'implementationStatus', 'projectID'],
        },
      ],
    });
    if (!feature || !feature.activeFlag) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const recentHistory = await db.DesignFeatureHistory.findAll({
      where: { designFeatureID: feature.id },
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [{
        model: db.User, as: 'changedByUser',
        attributes: ['id', 'displayName', 'email', 'photoURL'],
      }],
    });

    const json = feature.toJSON();
    json.recentHistory = recentHistory;
    res.json(json);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const feature = await db.DesignFeature.findByPk(req.params.id);
    if (!feature || !feature.activeFlag) {
      return res.status(404).json({ error: 'Feature not found' });
    }
    if (feature.reviewState === 'released') {
      return res.status(400).json({
        error: 'This feature has been released and is read-only. Create a new feature record to make further changes.',
      });
    }

    if ('commitRefs' in req.body) {
      const commitErr = validateCommitRefs(req.body.commitRefs);
      if (commitErr) return res.status(400).json({ error: commitErr });
    }

    // Strip workflow fields — must use dedicated transition endpoints.
    delete req.body.reviewState;
    delete req.body.submittedAt;
    delete req.body.approvedAt;
    delete req.body.approvedByUserID;
    delete req.body.releasedAt;
    delete req.body.releasedByUserID;
    delete req.body.ownerUserID;
    delete req.body.activeFlag;
    delete req.body.id;

    const changes = {};
    for (const field of TRACKED_FIELDS) {
      if (field in req.body) {
        const oldVal = feature[field] ?? null;
        const newVal = req.body[field] ?? null;
        const same = JSON.stringify(oldVal) === JSON.stringify(newVal);
        if (!same) changes[field] = { from: oldVal, to: newVal };
      }
    }

    const changeNotes = req.body.changeNotes;
    delete req.body.changeNotes;

    await feature.update(req.body);

    if (Object.keys(changes).length > 0) {
      await recordHistory(feature.id, req.user.id, 'updated', changes, changeNotes);

      // Auto-reset approved → in_review on edit.
      if (feature.reviewState === 'approved') {
        const previousApprover = feature.approvedByUserID;
        await feature.update({ reviewState: 'in_review', approvedByUserID: null, approvedAt: null });
        await recordHistory(feature.id, req.user.id, 'rejected', {
          reviewState: { from: 'approved', to: 'in_review' },
          approvedByUserID: { from: previousApprover, to: null },
        }, 'Auto-reset on edit');
      }
    }

    res.json(feature);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.delete = async (req, res) => {
  try {
    const feature = await db.DesignFeature.findByPk(req.params.id);
    if (!feature || !feature.activeFlag) {
      return res.status(404).json({ error: 'Feature not found' });
    }
    // Clear designFeatureID from linked requirements (the FK is ON DELETE
    // SET NULL, but we soft-delete so we have to do this manually).
    await db.DesignRequirement.update(
      { designFeatureID: null },
      { where: { designFeatureID: feature.id } }
    );
    await feature.update({ activeFlag: false });
    await recordHistory(feature.id, req.user.id, 'deleted', {
      activeFlag: { from: true, to: false },
    });
    res.json({ message: 'Feature deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Workflow transitions ---------------------------------------------------

async function getActiveFeature(req, res) {
  const feature = await db.DesignFeature.findByPk(req.params.id);
  if (!feature || !feature.activeFlag) {
    res.status(404).json({ error: 'Feature not found' });
    return null;
  }
  return feature;
}

exports.submit = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    if (feature.reviewState !== 'draft') {
      return res.status(400).json({
        error: `Cannot submit a feature in state '${feature.reviewState}' — only draft features can be submitted for review`,
      });
    }
    await feature.update({ reviewState: 'in_review', submittedAt: new Date() });
    await recordHistory(feature.id, req.user.id, 'submitted', {
      reviewState: { from: 'draft', to: 'in_review' },
    });
    res.json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.approve = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    if (feature.reviewState !== 'in_review') {
      return res.status(400).json({
        error: `Cannot approve a feature in state '${feature.reviewState}' — submit for review first`,
      });
    }
    await feature.update({
      reviewState: 'approved',
      approvedByUserID: req.user.id,
      approvedAt: new Date(),
    });
    await recordHistory(feature.id, req.user.id, 'approved', {
      reviewState: { from: 'in_review', to: 'approved' },
      approvedByUserID: { from: null, to: req.user.id },
    });
    res.json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reject = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    if (feature.reviewState !== 'in_review') {
      return res.status(400).json({
        error: `Cannot reject a feature in state '${feature.reviewState}'`,
      });
    }
    const reason = req.body && req.body.reason;
    await feature.update({ reviewState: 'draft' });
    await recordHistory(feature.id, req.user.id, 'rejected', {
      reviewState: { from: 'in_review', to: 'draft' },
    }, reason);
    res.json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.release = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    if (feature.reviewState !== 'approved') {
      return res.status(400).json({
        error: `Cannot release a feature in state '${feature.reviewState}' — must be approved first`,
      });
    }
    await feature.update({
      reviewState: 'released',
      releasedByUserID: req.user.id,
      releasedAt: new Date(),
    });
    await recordHistory(feature.id, req.user.id, 'released', {
      reviewState: { from: 'approved', to: 'released' },
      releasedByUserID: { from: null, to: req.user.id },
    });
    res.json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Requirement linkage ----------------------------------------------------

exports.linkRequirement = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    const requirementID = req.body && req.body.requirementID;
    if (!requirementID) return res.status(400).json({ error: 'requirementID is required' });

    const requirement = await db.DesignRequirement.findByPk(requirementID);
    if (!requirement || !requirement.activeFlag) {
      return res.status(404).json({ error: `Requirement ${requirementID} not found` });
    }
    const previousFeatureID = requirement.designFeatureID;
    await requirement.update({ designFeatureID: feature.id });

    await recordHistory(feature.id, req.user.id, 'requirements_linked', {
      requirementID: { from: previousFeatureID, to: feature.id, requirement: requirement.id },
    });

    res.json({ success: true, requirementID: requirement.id, designFeatureID: feature.id });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.unlinkRequirement = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    const requirement = await db.DesignRequirement.findByPk(req.params.reqId);
    if (!requirement) {
      return res.status(404).json({ error: `Requirement ${req.params.reqId} not found` });
    }
    if (requirement.designFeatureID !== feature.id) {
      return res.status(400).json({
        error: `Requirement ${requirement.id} is not linked to this feature`,
      });
    }
    await requirement.update({ designFeatureID: null });

    await recordHistory(feature.id, req.user.id, 'requirements_unlinked', {
      requirementID: { from: feature.id, to: null, requirement: requirement.id },
    });

    res.json({ success: true, requirementID: requirement.id });
  } catch (error) {
    return handleError(res, error);
  }
};

// --- GitHub sync -----------------------------------------------------------

exports.syncGithub = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;

    const user = await db.User.findByPk(req.user.id);
    if (!user || !user.githubPAT) {
      return res.status(400).json({
        error: 'No GitHub Personal Access Token configured. Add one in Settings before syncing.',
      });
    }

    let result;
    try {
      result = await syncFeatureFromGitHub(feature, user.githubPAT);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }

    await feature.update(result.updates);
    await recordHistory(feature.id, req.user.id, 'updated', {
      synced_from_github: { from: null, to: feature.prURL },
    }, `Synced from GitHub. Rate limit remaining: ${result.rateLimit?.remaining}`);

    const refreshed = await db.DesignFeature.findByPk(feature.id, { include: featureIncludes });
    res.json(refreshed);
  } catch (error) {
    return handleError(res, error);
  }
};

// --- GitHub browse (read-only) --------------------------------------------

async function resolveRepo(req, feature) {
  // Explicit ?repo=owner/repo wins; else feature.githubRepo; else parse prURL.
  const explicit = req.query && req.query.repo;
  if (explicit) {
    const parsed = parseRepoString(explicit);
    if (!parsed) throw Object.assign(new Error(`Invalid repo string '${explicit}' — expected owner/repo`), { status: 400 });
    return parsed;
  }
  if (feature && feature.githubRepo) {
    const parsed = parseRepoString(feature.githubRepo);
    if (parsed) return parsed;
  }
  if (feature && feature.prURL) {
    const parsed = parsePrURL(feature.prURL);
    if (parsed) return { owner: parsed.owner, repo: parsed.repo };
  }
  throw Object.assign(new Error('No repo specified — pass ?repo=owner/repo or set the feature\'s repo first'), { status: 400 });
}

async function getUserPAT(userID) {
  const user = await db.User.findByPk(userID, { attributes: ['githubPAT'] });
  if (!user || !user.githubPAT) {
    throw Object.assign(new Error('No GitHub Personal Access Token configured. Add one in Settings.'), { status: 400 });
  }
  return user.githubPAT;
}

exports.listGithubBranches = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    const token = await getUserPAT(req.user.id);

    // If ?repo=owner/repo provided, fetch just that one. Otherwise fetch all
    // configured repos (env GITHUB_REPOS) and merge sorted by recency.
    let repos = [];
    if (req.query && req.query.repo) {
      const parsed = parseRepoString(req.query.repo);
      if (!parsed) {
        return res.status(400).json({ error: `Invalid repo '${req.query.repo}' — expected owner/repo` });
      }
      repos = [parsed];
    } else {
      repos = getConfiguredRepos();
    }
    if (repos.length === 0) {
      return res.status(400).json({
        error: 'No repos configured. Set GITHUB_REPOS in the backend env (comma-separated owner/repo) or pass ?repo=owner/repo.',
      });
    }

    const merged = [];
    const errors = [];
    for (const r of repos) {
      try {
        const result = await listBranches(r, token);
        const repoStr = `${r.owner}/${r.repo}`;
        for (const b of result.branches) {
          merged.push({ ...b, repo: repoStr, isDefault: b.name === result.defaultBranch });
        }
      } catch (e) {
        errors.push(`${r.owner}/${r.repo}: ${e.message}`);
      }
    }
    merged.sort((a, b) => (b.committedDate || '').localeCompare(a.committedDate || ''));

    res.json({ branches: merged, repos: repos.map(r => `${r.owner}/${r.repo}`), errors });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};

exports.listGithubBranchCommits = async (req, res) => {
  try {
    const feature = await getActiveFeature(req, res);
    if (!feature) return;
    const branch = req.query && req.query.branch;
    if (!branch) return res.status(400).json({ error: 'branch query parameter is required' });
    const repo = await resolveRepo(req, feature);
    const token = await getUserPAT(req.user.id);
    const commits = await listBranchCommits(repo, branch, token);
    res.json({ branch, repo: `${repo.owner}/${repo.repo}`, commits });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};

// --- History ---------------------------------------------------------------

exports.getHistory = async (req, res) => {
  try {
    const feature = await db.DesignFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const history = await db.DesignFeatureHistory.findAll({
      where: { designFeatureID: feature.id },
      include: [{
        model: db.User, as: 'changedByUser',
        attributes: ['id', 'displayName', 'email', 'photoURL'],
      }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit, offset,
    });

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
