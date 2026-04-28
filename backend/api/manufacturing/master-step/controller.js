const createError = require('http-errors');
const fileStorage = require('../../../util/fileStorage');

function humanizeError(error, context) {
  if (error.name === 'SequelizeUniqueConstraintError') {
    const fields = error.errors?.map(e => e.path).join(', ') || 'unknown fields';
    return createError(409, `${context}: A record with the same ${fields} already exists`);
  }
  if (error.name === 'SequelizeValidationError') {
    const msgs = error.errors?.map(e => e.message).join('; ') || error.message;
    return createError(400, `${context}: ${msgs}`);
  }
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return createError(400, `${context}: Referenced record does not exist`);
  }
  return createError(500, `${context}: ${error.message}`);
}

async function logHistory(masterID, changeType, userID, changes = null) {
  await db.EngineeringMasterHistory.create({
    engineeringMasterID: masterID,
    changeType,
    changes,
    changedByUserID: userID,
    createdAt: new Date(),
  });
}

function formatQty(quantity, uom) {
  const val = Number(quantity);
  if (uom?.allowDecimal) return String(val);
  return String(Math.round(val));
}

function computeMarkerDiff(oldMarkers, newMarkers) {
  // Multiple pins can share the same label. Compare by exact position fingerprint.
  // A pin is identified as "added" if its (label, x, y) doesn't appear in old.
  // A pin is "removed" if its (label, x, y) doesn't appear in new.
  // A "moved" pin = same label, but the count for that label changed in a way
  // that suggests one was repositioned (one removed + one added with same label
  // and the rest of that label's pins unchanged).
  const fingerprint = m => `${m.label}@${Math.round(m.x)},${Math.round(m.y)}`;
  const oldKeys = oldMarkers.map(fingerprint);
  const newKeys = newMarkers.map(fingerprint);

  // Multiset diff
  const oldCount = new Map();
  const newCount = new Map();
  for (const k of oldKeys) oldCount.set(k, (oldCount.get(k) || 0) + 1);
  for (const k of newKeys) newCount.set(k, (newCount.get(k) || 0) + 1);

  const addedKeys = [];
  const removedKeys = [];
  for (const [k, c] of newCount) {
    const diff = c - (oldCount.get(k) || 0);
    for (let i = 0; i < diff; i++) addedKeys.push(k);
  }
  for (const [k, c] of oldCount) {
    const diff = c - (newCount.get(k) || 0);
    for (let i = 0; i < diff; i++) removedKeys.push(k);
  }

  // Try to pair adds and removes with the same label as "moves"
  const added = [];
  const removed = [];
  const changed = [];
  const removedByLabel = new Map();
  for (const k of removedKeys) {
    const label = k.split('@')[0];
    if (!removedByLabel.has(label)) removedByLabel.set(label, []);
    removedByLabel.get(label).push(k);
  }

  for (const k of addedKeys) {
    const label = k.split('@')[0];
    const matches = removedByLabel.get(label);
    if (matches && matches.length > 0) {
      const oldKey = matches.shift();
      const oldPos = oldKey.split('@')[1];
      const newPos = k.split('@')[1];
      changed.push({ from: `Pin ${label} (${oldPos})`, to: `Pin ${label} (${newPos})` });
    } else {
      const pos = k.split('@')[1];
      added.push(`Pin ${label} (${pos})`);
    }
  }
  // Anything left in removedByLabel is a true removal
  for (const [label, keys] of removedByLabel) {
    for (const k of keys) {
      const pos = k.split('@')[1];
      removed.push(`Pin ${label} (${pos})`);
    }
  }

  if (!added.length && !removed.length && !changed.length) return null;
  return { added, removed, changed };
}

function computeStepItemDiff(oldItems, newItems) {
  const fmt = i => ({ key: `${i.partID}-${i.isTool}`, label: `${i.part?.name} ×${formatQty(i.quantity, i.part?.UnitOfMeasure)}${i.isTool ? ' (tool)' : ''}` });
  const oldMap = new Map(oldItems.map(i => { const f = fmt(i); return [f.key, f]; }));
  const newMap = new Map(newItems.map(i => { const f = fmt(i); return [f.key, f]; }));
  const added = [], removed = [], changed = [];
  for (const [key, item] of newMap) {
    if (!oldMap.has(key)) added.push(item.label);
    else if (oldMap.get(key).label !== item.label) changed.push({ from: oldMap.get(key).label, to: item.label });
  }
  for (const [key, item] of oldMap) {
    if (!newMap.has(key)) removed.push(item.label);
  }
  if (!added.length && !removed.length && !changed.length) return null;
  return { added, removed, changed };
}

async function ensureDraft(masterID) {
  const master = await db.EngineeringMaster.findByPk(masterID);
  if (!master || !master.activeFlag) {
    throw createError(404, 'Engineering Master not found');
  }
  if (master.releaseState !== 'draft') {
    throw createError(400, 'Engineering Master must be in draft state');
  }
  return master;
}

async function replaceStepItems(stepID, parts, tooling) {
  await db.EngineeringMasterStepItem.destroy({ where: { stepID } });

  const allItems = [];
  const seen = new Set();

  if (parts) {
    for (const p of parts) {
      if (seen.has(p.partID)) continue;
      seen.add(p.partID);
      allItems.push({ stepID, partID: p.partID, quantity: p.quantity || 1, isTool: false, createdAt: new Date() });
    }
  }
  if (tooling) {
    for (const t of tooling) {
      if (seen.has(t.partID)) continue;
      seen.add(t.partID);
      allItems.push({ stepID, partID: t.partID, quantity: t.quantity || 1, isTool: true, createdAt: new Date() });
    }
  }

  if (allItems.length > 0) {
    await db.EngineeringMasterStepItem.bulkCreate(allItems);
  }
}

async function replaceMarkers(stepID, markers) {
  await db.EngineeringMasterStepMarker.destroy({ where: { stepID } });

  if (markers && markers.length > 0) {
    await db.EngineeringMasterStepMarker.bulkCreate(
      markers.map(m => ({ stepID, label: m.label, x: m.x, y: m.y, createdAt: new Date() }))
    );
  }
}

function stepIncludes() {
  return [
    {
      model: db.EngineeringMasterStepItem, as: 'items',
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
}

// POST /
exports.create = async (req, res, next) => {
  try {
    const { engineeringMasterID, stepNumber, title, instructions, parts, tooling, markers } = req.body;
    await ensureDraft(engineeringMasterID);

    let finalStepNumber = stepNumber;
    if (!finalStepNumber) {
      const maxStep = await db.EngineeringMasterStep.findOne({
        where: { engineeringMasterID },
        order: [['stepNumber', 'DESC']],
      });
      finalStepNumber = maxStep ? maxStep.stepNumber + 10 : 10;
    }

    const step = await db.EngineeringMasterStep.create({
      engineeringMasterID,
      stepNumber: finalStepNumber,
      title,
      instructions: instructions || null,
    });

    await replaceStepItems(step.id, parts, tooling);
    await replaceMarkers(step.id, markers);

    await logHistory(engineeringMasterID, 'updated', req.user.id, {
      step: { from: '(none)', to: `Step ${finalStepNumber}: ${title}` }
    });

    const result = await db.EngineeringMasterStep.findByPk(step.id, { include: stepIncludes() });
    res.status(201).json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(humanizeError(error, 'Failed to create step'));
  }
};

// PUT /:id
exports.update = async (req, res, next) => {
  try {
    const step = await db.EngineeringMasterStep.findByPk(req.params.id);
    if (!step) return next(createError(404, 'Step not found'));

    await ensureDraft(step.engineeringMasterID);

    const { title, instructions, parts, tooling, markers } = req.body;
    const changes = {};
    const stepLabel = `Step ${step.stepNumber}`;

    if (title !== undefined && title !== step.title) {
      changes[`${stepLabel} title`] = { from: step.title, to: title };
    }
    if (instructions !== undefined && instructions !== step.instructions) {
      changes[`${stepLabel} instructions`] = { from: step.instructions || '(empty)', to: instructions || '(empty)' };
    }

    await step.update({
      title: title ?? step.title,
      instructions: instructions !== undefined ? instructions : step.instructions,
    });

    if (parts !== undefined || tooling !== undefined) {
      // Capture old items for history
      const partInclude = { model: db.Part, as: 'part', attributes: ['id', 'name', 'defaultUnitOfMeasureID'], include: [{ model: db.UnitOfMeasure, as: 'UnitOfMeasure', attributes: ['allowDecimal'] }] };

      const oldItems = await db.EngineeringMasterStepItem.findAll({ where: { stepID: step.id }, include: [partInclude] });

      await replaceStepItems(step.id, parts, tooling);

      const newItems = await db.EngineeringMasterStepItem.findAll({ where: { stepID: step.id }, include: [partInclude] });
      const stepItemDiff = computeStepItemDiff(oldItems, newItems);
      if (stepItemDiff) {
        changes[`${stepLabel} parts`] = stepItemDiff;
      }
    }
    if (markers !== undefined) {
      const oldMarkers = await db.EngineeringMasterStepMarker.findAll({ where: { stepID: step.id } });
      await replaceMarkers(step.id, markers);
      const newMarkers = await db.EngineeringMasterStepMarker.findAll({ where: { stepID: step.id } });
      const markerDiff = computeMarkerDiff(oldMarkers, newMarkers);
      if (markerDiff) {
        changes[`${stepLabel} pins`] = markerDiff;
      }
    }

    if (Object.keys(changes).length > 0) {
      await logHistory(step.engineeringMasterID, 'updated', req.user.id, changes);
    }

    const result = await db.EngineeringMasterStep.findByPk(step.id, { include: stepIncludes() });
    res.json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(humanizeError(error, 'Failed to update step'));
  }
};

// DELETE /:id
exports.remove = async (req, res, next) => {
  try {
    const step = await db.EngineeringMasterStep.findByPk(req.params.id);
    if (!step) return next(createError(404, 'Step not found'));

    await ensureDraft(step.engineeringMasterID);

    const masterID = step.engineeringMasterID;
    const stepLabel = `Step ${step.stepNumber}: ${step.title}`;
    await step.destroy();
    await logHistory(masterID, 'updated', req.user.id, {
      step: { from: stepLabel, to: '(deleted)' }
    });
    res.json({ message: 'Step deleted' });
  } catch (error) {
    if (error.status) return next(error);
    next(createError(500, 'Failed to delete step: ' + error.message));
  }
};

// PUT /:id/reorder
exports.reorder = async (req, res, next) => {
  try {
    const step = await db.EngineeringMasterStep.findByPk(req.params.id);
    if (!step) return next(createError(404, 'Step not found'));

    await ensureDraft(step.engineeringMasterID);

    const { stepNumber } = req.body;
    const oldNumber = step.stepNumber;
    await step.update({ stepNumber });

    if (oldNumber !== stepNumber) {
      await logHistory(step.engineeringMasterID, 'updated', req.user.id, {
        [`Step ${step.title} number`]: { from: String(oldNumber), to: String(stepNumber) }
      });
    }

    const result = await db.EngineeringMasterStep.findByPk(step.id, { include: stepIncludes() });
    res.json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(createError(500, 'Failed to reorder step: ' + error.message));
  }
};

// POST /:masterId/upload-image/:stepId
exports.uploadImage = async (req, res, next) => {
  try {
    const { filename, mimeType, data } = req.body;
    if (!filename || !mimeType || !data) {
      return next(createError(400, 'Missing filename, mimeType, or data'));
    }

    const step = await db.EngineeringMasterStep.findByPk(req.params.stepId, {
      include: [{ model: db.UploadedFile, as: 'imageFile', attributes: ['id', 'filename'] }],
    });
    if (!step) return next(createError(404, 'Step not found'));

    await ensureDraft(step.engineeringMasterID);

    const oldFilename = step.imageFile?.filename || '(none)';

    const buffer = fileStorage.decodeBase64(data);
    const filePath = fileStorage.saveFile(buffer, mimeType, filename);

    const file = await db.UploadedFile.create({
      filename,
      mimeType,
      fileSize: buffer.length,
      filePath,
      data: null,
      activeFlag: true,
    });

    await step.update({ imageFileID: file.id });

    await logHistory(step.engineeringMasterID, 'updated', req.user.id, {
      [`Step ${step.stepNumber} image`]: { from: oldFilename, to: filename }
    });

    const result = await db.EngineeringMasterStep.findByPk(step.id, { include: stepIncludes() });
    res.json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(createError(500, 'Failed to upload image: ' + error.message));
  }
};

// DELETE /:id/image
exports.deleteImage = async (req, res, next) => {
  try {
    const step = await db.EngineeringMasterStep.findByPk(req.params.id, {
      include: [{ model: db.UploadedFile, as: 'imageFile', attributes: ['id', 'filename'] }],
    });
    if (!step) return next(createError(404, 'Step not found'));

    await ensureDraft(step.engineeringMasterID);

    const oldFilename = step.imageFile?.filename || '(none)';
    if (!step.imageFileID) {
      return res.json({ message: 'No image to remove' });
    }

    await step.update({ imageFileID: null });

    await logHistory(step.engineeringMasterID, 'updated', req.user.id, {
      [`Step ${step.stepNumber} image`]: { from: oldFilename, to: '(none)' }
    });

    const result = await db.EngineeringMasterStep.findByPk(step.id, { include: stepIncludes() });
    res.json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(createError(500, 'Failed to remove image: ' + error.message));
  }
};
