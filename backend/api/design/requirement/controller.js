const db = require('../../../models');

const TRACKED_FIELDS = ['description', 'rationale', 'parameter', 'verification', 'validation', 'parentRequirementID', 'projectID', 'categoryID'];

const requirementIncludes = [
  {
    model: db.User,
    as: 'owner',
    attributes: ['id', 'displayName', 'email', 'photoURL']
  },
  {
    model: db.User,
    as: 'approvedBy',
    attributes: ['id', 'displayName', 'email', 'photoURL']
  },
  {
    model: db.Project,
    as: 'project',
    attributes: ['id', 'name', 'shortName', 'tagColorHex']
  },
  {
    model: db.RequirementCategory,
    as: 'category',
    attributes: ['id', 'name', 'description']
  },
  {
    model: db.DesignRequirement,
    as: 'parentRequirement',
    attributes: ['id', 'description']
  }
];

async function recordHistory(requirementID, changedByUserID, changeType, changes, changeNotes) {
  await db.RequirementHistory.create({
    requirementID, changedByUserID, changeType, changes, changeNotes, createdAt: new Date()
  });
}

exports.create = async (req, res) => {
  try {
    if (!req.body.description) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (!req.body.projectID) {
      return res.status(400).json({ error: 'projectID is required' });
    }
    const requirement = await db.DesignRequirement.create({
      ...req.body,
      ownerUserID: req.user.id
    });

    const changes = {};
    for (const field of TRACKED_FIELDS) {
      if (requirement[field] != null) {
        changes[field] = { from: null, to: requirement[field] };
      }
    }
    await recordHistory(requirement.id, req.user.id, 'created', changes);

    res.status(201).json(requirement);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const where = { activeFlag: true };
    if (req.query.projectID) {
      where.projectID = req.query.projectID;
    }
    const requirements = await db.DesignRequirement.findAll({
      where,
      include: requirementIncludes,
      order: [['id', 'ASC']]
    });
    res.json(requirements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id, {
      include: requirementIncludes
    });
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    res.json(requirement);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }

    // Strip approval fields — must use dedicated approve/unapprove endpoints
    delete req.body.approved;
    delete req.body.approvedByUserID;
    delete req.body.approvedAt;

    const changes = {};
    for (const field of TRACKED_FIELDS) {
      if (field in req.body) {
        const oldVal = requirement[field] ?? null;
        const newVal = req.body[field] ?? null;
        if (oldVal !== newVal) {
          changes[field] = { from: oldVal, to: newVal };
        }
      }
    }

    const changeNotes = req.body.changeNotes;
    await requirement.update(req.body);

    if (Object.keys(changes).length > 0) {
      await recordHistory(requirement.id, req.user.id, 'updated', changes, changeNotes);

      // Auto-unapprove on edit
      if (requirement.approved) {
        const previousApprover = requirement.approvedByUserID;
        await requirement.update({ approved: false, approvedByUserID: null, approvedAt: null });
        await recordHistory(requirement.id, req.user.id, 'unapproved', {
          approved: { from: true, to: false },
          approvedByUserID: { from: previousApprover, to: null }
        });
      }
    }

    res.json(requirement);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    await requirement.update({ activeFlag: false });
    await recordHistory(requirement.id, req.user.id, 'deleted', {
      activeFlag: { from: true, to: false }
    });
    res.json({ message: 'Requirement deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.approve = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    await requirement.update({
      approved: true,
      approvedByUserID: req.user.id,
      approvedAt: new Date()
    });
    await recordHistory(requirement.id, req.user.id, 'approved', {
      approved: { from: false, to: true },
      approvedByUserID: { from: null, to: req.user.id }
    });
    res.json(requirement);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.unapprove = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    const previousApprover = requirement.approvedByUserID;
    await requirement.update({
      approved: false,
      approvedByUserID: null,
      approvedAt: null
    });
    await recordHistory(requirement.id, req.user.id, 'unapproved', {
      approved: { from: true, to: false },
      approvedByUserID: { from: previousApprover, to: null }
    });
    res.json(requirement);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.takeOwnership = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    const previousOwner = requirement.ownerUserID;
    await requirement.update({ ownerUserID: req.user.id });
    await recordHistory(requirement.id, req.user.id, 'updated', {
      ownerUserID: { from: previousOwner, to: req.user.id }
    });
    const updated = await db.DesignRequirement.findByPk(req.params.id, {
      include: requirementIncludes
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const USER_ID_FIELDS = ['ownerUserID', 'approvedByUserID', 'changedByUserID'];

exports.getHistory = async (req, res) => {
  try {
    const requirement = await db.DesignRequirement.findByPk(req.params.id);
    if (!requirement) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    const history = await db.RequirementHistory.findAll({
      where: { requirementID: req.params.id },
      include: [{
        model: db.User,
        as: 'changedBy',
        attributes: ['id', 'displayName', 'email', 'photoURL']
      }],
      order: [['createdAt', 'DESC']]
    });

    // Collect all user IDs referenced in changes
    const userIds = new Set();
    for (const entry of history) {
      if (!entry.changes) continue;
      for (const field of USER_ID_FIELDS) {
        if (entry.changes[field]) {
          if (entry.changes[field].from) userIds.add(entry.changes[field].from);
          if (entry.changes[field].to) userIds.add(entry.changes[field].to);
        }
      }
    }

    // Fetch users and build lookup
    const userLookup = {};
    if (userIds.size > 0) {
      const users = await db.User.findAll({
        where: { id: [...userIds] },
        attributes: ['id', 'displayName']
      });
      for (const u of users) {
        userLookup[u.id] = u.displayName;
      }
    }

    // Annotate changes with display names
    const result = history.map(entry => {
      const plain = entry.toJSON();
      if (!plain.changes) return plain;
      for (const field of USER_ID_FIELDS) {
        if (plain.changes[field]) {
          if (plain.changes[field].from && userLookup[plain.changes[field].from]) {
            plain.changes[field].fromName = userLookup[plain.changes[field].from];
          }
          if (plain.changes[field].to && userLookup[plain.changes[field].to]) {
            plain.changes[field].toName = userLookup[plain.changes[field].to];
          }
        }
      }
      return plain;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
