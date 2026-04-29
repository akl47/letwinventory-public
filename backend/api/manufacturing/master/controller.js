const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

const STEP_INCLUDE = [
  {
    model: db.EngineeringMasterStepItem,
    as: 'items',
    include: [{
      model: db.Part, as: 'part',
      attributes: ['id', 'name', 'revision', 'description', 'imageFileID', 'defaultUnitOfMeasureID'],
      include: [
        { model: db.UploadedFile, as: 'imageFile', attributes: ['id'] },
        { model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['id', 'name', 'allowDecimal'] },
      ],
    }],
  },
  { model: db.EngineeringMasterStepMarker, as: 'markers' },
  { model: db.UploadedFile, as: 'imageFile', attributes: ['id', 'filename', 'mimeType'] },
];

function masterIncludes() {
  return [
    {
      model: db.EngineeringMasterOutputPart, as: 'outputParts',
      include: [{
        model: db.Part, as: 'part',
        attributes: ['id', 'name', 'revision', 'description', 'imageFileID', 'defaultUnitOfMeasureID'],
        include: [
          { model: db.UploadedFile, as: 'imageFile', attributes: ['id'] },
          { model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['id', 'name', 'allowDecimal'] },
        ],
      }],
    },
    {
      model: db.EngineeringMasterStep, as: 'steps',
      include: STEP_INCLUDE,
      order: [['stepNumber', 'ASC']],
    },
    {
      model: db.EngineeringMasterBomItem, as: 'bomItems',
      include: [{
        model: db.Part, as: 'part',
        attributes: ['id', 'name', 'revision', 'description', 'imageFileID', 'defaultUnitOfMeasureID'],
        include: [
          { model: db.UploadedFile, as: 'imageFile', attributes: ['id'] },
          { model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['id', 'name', 'allowDecimal'] },
        ],
      }],
    },
  ];
}

function formatMasterResponse(master) {
  const json = master.toJSON();
  if (json.steps) {
    json.steps = json.steps.map(step => {
      const parts = (step.items || []).filter(i => !i.isTool);
      const tooling = (step.items || []).filter(i => i.isTool);
      return { ...step, parts, tooling, items: undefined };
    });
    json.steps.sort((a, b) => a.stepNumber - b.stepNumber);
  }
  return json;
}

function formatQty(quantity, uom) {
  const val = Number(quantity);
  if (uom?.allowDecimal) return String(val);
  return String(Math.round(val));
}

/**
 * Compute a diff between two lists of "{name} ×{qty}" strings.
 * Returns { added: [...], removed: [...], changed: [...] } or null if no diff.
 */
function computeListDiff(oldItems, newItems) {
  const oldMap = new Map(oldItems.map(i => [i.key, i]));
  const newMap = new Map(newItems.map(i => [i.key, i]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, item] of newMap) {
    if (!oldMap.has(key)) {
      added.push(item.label);
    } else if (oldMap.get(key).label !== item.label) {
      changed.push({ from: oldMap.get(key).label, to: item.label });
    }
  }
  for (const [key, item] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(item.label);
    }
  }

  if (!added.length && !removed.length && !changed.length) return null;
  return { added, removed, changed };
}

function formatPartList(items) {
  return items.map(i => ({
    key: `${i.partID}-${i.isTool || false}`,
    label: `${i.part?.name} ×${formatQty(i.quantity, i.part?.UnitOfMeasure)}${i.isTool ? ' (tool)' : ''}`,
    partID: i.partID,
  }));
}

function formatOutputPartList(items) {
  return items.map(i => ({
    key: String(i.partID),
    label: `${i.part?.name} ×${formatQty(i.quantity, i.part?.UnitOfMeasure)}`,
    partID: i.partID,
  }));
}

async function logHistory(masterID, changeType, userID, changes = null, snapshotData = null) {
  await db.EngineeringMasterHistory.create({
    engineeringMasterID: masterID,
    changeType,
    changes,
    snapshotData,
    changedByUserID: userID,
    createdAt: new Date(),
  });
}

function getNextRevision(current) {
  const num = parseInt(current, 10);
  if (!isNaN(num)) {
    return String(num + 1).padStart(2, '0');
  }
  // Fallback for legacy letter revisions
  return '01';
}

// GET /
exports.getAll = async (req, res, next) => {
  try {
    const masters = await db.EngineeringMaster.findAll({
      where: { activeFlag: true },
      include: [
        {
          model: db.EngineeringMasterOutputPart, as: 'outputParts',
          include: [{
            model: db.Part, as: 'part', attributes: ['id', 'name', 'revision', 'defaultUnitOfMeasureID'],
            include: [{ model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['id', 'name', 'allowDecimal'] }],
          }],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const result = await Promise.all(masters.map(async m => {
      const stepCount = await db.EngineeringMasterStep.count({ where: { engineeringMasterID: m.id } });
      const json = m.toJSON();
      json.stepCount = stepCount;
      return json;
    }));

    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch engineering masters'));
  }
};

// GET /:id
exports.getById = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id, {
      include: masterIncludes(),
    });

    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }

    res.json(formatMasterResponse(master));
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch engineering master'));
  }
};

// POST /
exports.create = async (req, res, next) => {
  try {
    const { name, description, outputParts } = req.body;

    // Find next available revision for this name
    let revision = '01';
    const existingRevs = await db.EngineeringMaster.findAll({
      where: { name },
      attributes: ['revision'],
    });
    const usedRevs = new Set(existingRevs.map(m => m.revision));
    while (usedRevs.has(revision)) {
      revision = getNextRevision(revision);
    }

    const master = await db.EngineeringMaster.create({
      name,
      description,
      revision,
      releaseState: 'draft',
      createdByUserID: req.user.id,
    });

    if (outputParts && outputParts.length > 0) {
      const seen = new Set();
      const uniqueParts = outputParts.filter(op => {
        if (seen.has(op.partID)) return false;
        seen.add(op.partID);
        return true;
      });
      await db.EngineeringMasterOutputPart.bulkCreate(
        uniqueParts.map(op => ({
          engineeringMasterID: master.id,
          partID: op.partID,
          quantity: op.quantity || 1,
          createdAt: new Date(),
        }))
      );
    }

    await logHistory(master.id, 'created', req.user.id);

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    res.status(201).json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to create engineering master'));
  }
};

// PUT /:id
exports.update = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'draft') {
      return next(createError(400, 'Engineering Master must be in draft state to edit'));
    }

    const { name, description, outputParts } = req.body;
    const changes = {};
    if (name !== undefined && name !== master.name) changes.name = { from: master.name, to: name };
    if (description !== undefined && description !== master.description) changes.description = { from: master.description, to: description };

    await master.update({ name: name ?? master.name, description: description ?? master.description });

    if (outputParts !== undefined) {
      const partInclude = { model: db.Part, as: 'part', attributes: ['id', 'name', 'defaultUnitOfMeasureID'], include: [{ model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['allowDecimal'] }] };
      const oldOutputParts = await db.EngineeringMasterOutputPart.findAll({
        where: { engineeringMasterID: master.id },
        include: [partInclude],
      });
      const oldList = formatOutputPartList(oldOutputParts);

      await db.EngineeringMasterOutputPart.destroy({ where: { engineeringMasterID: master.id } });
      if (outputParts.length > 0) {
        const seen = new Set();
        const uniqueParts = outputParts.filter(op => {
          if (seen.has(op.partID)) return false;
          seen.add(op.partID);
          return true;
        });
        await db.EngineeringMasterOutputPart.bulkCreate(
          uniqueParts.map(op => ({
            engineeringMasterID: master.id,
            partID: op.partID,
            quantity: op.quantity || 1,
            createdAt: new Date(),
          }))
        );
      }

      const newParts = await db.EngineeringMasterOutputPart.findAll({
        where: { engineeringMasterID: master.id },
        include: [partInclude],
      });
      const newList = formatOutputPartList(newParts);
      const diff = computeListDiff(oldList, newList);
      if (diff) {
        changes.outputParts = diff;
      }
    }

    if (Object.keys(changes).length > 0) {
      await logHistory(master.id, 'updated', req.user.id, changes);
    }

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    res.json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to update engineering master'));
  }
};

// DELETE /:id
exports.remove = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'draft') {
      return next(createError(400, 'Only draft Engineering Masters can be deleted'));
    }

    await master.update({ activeFlag: false });
    await logHistory(master.id, 'deleted', req.user.id);

    res.json({ message: 'Engineering Master deleted' });
  } catch (error) {
    next(humanizeError(error, 'Failed to delete engineering master'));
  }
};

// POST /:id/submit-review
exports.submitForReview = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'draft') {
      return next(createError(400, 'Engineering Master must be in draft state'));
    }

    const stepCount = await db.EngineeringMasterStep.count({ where: { engineeringMasterID: master.id } });
    if (stepCount === 0) {
      return next(createError(400, 'Engineering Master must have at least one step'));
    }

    // Check for unassigned BOM parts
    const bomItems = await db.EngineeringMasterBomItem.findAll({
      where: { engineeringMasterID: master.id },
      include: [{ model: db.Part, as: 'part', attributes: ['id', 'name'] }],
    });
    const steps = await db.EngineeringMasterStep.findAll({
      where: { engineeringMasterID: master.id },
      include: [{ model: db.EngineeringMasterStepItem, as: 'items' }],
    });
    const assignedKeys = new Set();
    for (const step of steps) {
      for (const item of (step.items || [])) {
        assignedKeys.add(`${item.partID}-${item.isTool}`);
      }
    }
    const unassigned = bomItems.filter(bi => !assignedKeys.has(`${bi.partID}-${bi.isTool}`));
    const warnings = [];
    if (unassigned.length > 0) {
      warnings.push(`${unassigned.length} BOM item(s) not assigned to any step: ${unassigned.map(bi => bi.part?.name).join(', ')}`);
    }

    await master.update({ releaseState: 'review' });
    await logHistory(master.id, 'submitted', req.user.id);

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    const response = formatMasterResponse(result);
    if (warnings.length > 0) {
      response.warnings = warnings;
    }
    res.json(response);
  } catch (error) {
    next(humanizeError(error, 'Failed to submit for review'));
  }
};

// POST /:id/reject
exports.reject = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'review') {
      return next(createError(400, 'Engineering Master must be in review state'));
    }

    await master.update({ releaseState: 'draft' });
    await logHistory(master.id, 'rejected', req.user.id);

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    res.json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to reject'));
  }
};

// POST /:id/release
exports.release = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'review') {
      return next(createError(400, 'Engineering Master must be in review state'));
    }

    await master.update({
      releaseState: 'released',
      releasedAt: new Date(),
      releasedByUserID: req.user.id,
    });
    await logHistory(master.id, 'released', req.user.id);

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    res.json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to release'));
  }
};

// POST /:id/new-revision
exports.newRevision = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id, {
      include: masterIncludes(),
    });
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'released') {
      return next(createError(400, 'Can only create new revision from a released master'));
    }

    // Find next available revision number
    let nextRev = getNextRevision(master.revision);
    const existingRevs = await db.EngineeringMaster.findAll({
      where: { name: master.name },
      attributes: ['revision'],
    });
    const usedRevs = new Set(existingRevs.map(m => m.revision));
    while (usedRevs.has(nextRev)) {
      nextRev = getNextRevision(nextRev);
    }

    const newMaster = await db.EngineeringMaster.create({
      name: master.name,
      description: master.description,
      revision: nextRev,
      releaseState: 'draft',
      previousRevisionID: master.id,
      createdByUserID: req.user.id,
    });

    // Copy output parts
    const outputParts = await db.EngineeringMasterOutputPart.findAll({ where: { engineeringMasterID: master.id } });
    for (const op of outputParts) {
      await db.EngineeringMasterOutputPart.create({
        engineeringMasterID: newMaster.id,
        partID: op.partID,
        quantity: op.quantity,
        createdAt: new Date(),
      });
    }

    // Copy BOM items
    const bomItems = await db.EngineeringMasterBomItem.findAll({ where: { engineeringMasterID: master.id } });
    for (const bi of bomItems) {
      await db.EngineeringMasterBomItem.create({
        engineeringMasterID: newMaster.id,
        partID: bi.partID,
        quantity: bi.quantity,
        isTool: bi.isTool,
        createdAt: new Date(),
      });
    }

    // Copy steps with items and markers
    const steps = await db.EngineeringMasterStep.findAll({
      where: { engineeringMasterID: master.id },
      include: STEP_INCLUDE,
    });
    for (const step of steps) {
      const newStep = await db.EngineeringMasterStep.create({
        engineeringMasterID: newMaster.id,
        stepNumber: step.stepNumber,
        title: step.title,
        instructions: step.instructions,
        imageFileID: step.imageFileID,
      });

      if (step.items && step.items.length > 0) {
        await db.EngineeringMasterStepItem.bulkCreate(
          step.items.map(item => ({
            stepID: newStep.id,
            partID: item.partID,
            quantity: item.quantity,
            isTool: item.isTool,
            createdAt: new Date(),
          }))
        );
      }

      if (step.markers && step.markers.length > 0) {
        await db.EngineeringMasterStepMarker.bulkCreate(
          step.markers.map(marker => ({
            stepID: newStep.id,
            label: marker.label,
            x: marker.x,
            y: marker.y,
            createdAt: new Date(),
          }))
        );
      }
    }

    await logHistory(newMaster.id, 'new_revision', req.user.id, { previousRevision: master.revision });

    const result = await db.EngineeringMaster.findByPk(newMaster.id, { include: masterIncludes() });
    res.status(201).json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to create new revision'));
  }
};

// GET /:id/history
exports.getHistory = async (req, res, next) => {
  try {
    const history = await db.EngineeringMasterHistory.findAll({
      where: { engineeringMasterID: req.params.id },
      include: [{ model: db.User, as: 'changedBy', attributes: ['id', 'displayName'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(history);
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch history'));
  }
};

// GET /:id/revisions
exports.getRevisions = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master) {
      return next(createError(404, 'Engineering Master not found'));
    }

    // Walk back to the root
    let rootId = master.id;
    let current = master;
    while (current.previousRevisionID) {
      current = await db.EngineeringMaster.findByPk(current.previousRevisionID);
      if (!current) break;
      rootId = current.id;
    }

    // Collect all revisions forward from root
    const allMasters = await db.EngineeringMaster.findAll({
      where: { name: master.name, activeFlag: true },
      attributes: ['id', 'name', 'revision', 'releaseState', 'previousRevisionID', 'createdAt'],
      order: [['createdAt', 'ASC']],
    });

    res.json(allMasters);
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch revisions'));
  }
};

// PUT /:id/bom — Replace all BOM items for this master
exports.updateBom = async (req, res, next) => {
  try {
    const master = await db.EngineeringMaster.findByPk(req.params.id);
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'draft') {
      return next(createError(400, 'Engineering Master must be in draft state'));
    }

    const { items } = req.body; // [{ partID, quantity, isTool }]

    // Capture old BOM for history
    const bomPartInclude = { model: db.Part, as: 'part', attributes: ['id', 'name', 'defaultUnitOfMeasureID'], include: [{ model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['allowDecimal'] }] };
    const oldBom = await db.EngineeringMasterBomItem.findAll({
      where: { engineeringMasterID: master.id },
      include: [bomPartInclude],
    });
    const oldList = formatPartList(oldBom);

    await db.EngineeringMasterBomItem.destroy({ where: { engineeringMasterID: master.id } });

    if (items && items.length > 0) {
      await db.EngineeringMasterBomItem.bulkCreate(
        items.map(item => ({
          engineeringMasterID: master.id,
          partID: item.partID,
          quantity: item.quantity || 1,
          isTool: item.isTool || false,
          createdAt: new Date(),
        }))
      );
    }

    const newBom = await db.EngineeringMasterBomItem.findAll({
      where: { engineeringMasterID: master.id },
      include: [bomPartInclude],
    });
    const newList = formatPartList(newBom);
    const bomDiff = computeListDiff(oldList, newList);

    if (bomDiff) {
      await logHistory(master.id, 'updated', req.user.id, { bom: bomDiff });
    }

    const result = await db.EngineeringMaster.findByPk(master.id, { include: masterIncludes() });
    res.json(formatMasterResponse(result));
  } catch (error) {
    next(humanizeError(error, 'Failed to update BOM'));
  }
};
