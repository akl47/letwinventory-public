const createError = require('http-errors');

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

function masterStepIncludes() {
  return [
    {
      model: db.EngineeringMasterStepItem, as: 'items',
      include: [{
        model: db.Part, as: 'part',
        attributes: ['id', 'name', 'revision', 'description', 'imageFileID'],
        include: [{ model: db.UploadedFile, as: 'imageFile', attributes: ['id'] }],
      }],
    },
    { model: db.EngineeringMasterStepMarker, as: 'markers' },
    { model: db.UploadedFile, as: 'imageFile', attributes: ['id', 'filename', 'mimeType'] },
  ];
}

function outputTraceIncludes() {
  return {
    model: db.Trace, as: 'outputTraces',
    include: [
      {
        model: db.Part,
        attributes: ['id', 'name', 'revision', 'description', 'imageFileID'],
        include: [{ model: db.UploadedFile, as: 'imageFile', attributes: ['id'] }],
      },
      {
        model: db.Barcode,
        attributes: ['id', 'barcode', 'parentBarcodeID'],
      },
      { model: db.UnitOfMeasure, as: 'unitOfMeasure', attributes: ['id', 'name', 'allowDecimal'] },
    ],
  };
}

function workOrderIncludes() {
  return [
    {
      model: db.EngineeringMaster, as: 'master',
      attributes: ['id', 'name', 'revision', 'releaseState'],
      include: [
        {
          model: db.EngineeringMasterStep, as: 'steps',
          include: masterStepIncludes(),
        },
        {
          model: db.EngineeringMasterOutputPart, as: 'outputParts',
          include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision'] }],
        },
        {
          model: db.EngineeringMasterBomItem, as: 'bomItems',
          include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision'] }],
        },
      ],
    },
    {
      model: db.WorkOrderStepCompletion, as: 'stepCompletions',
      include: [{ model: db.User, as: 'completedBy', attributes: ['id', 'displayName'] }],
      order: [['completedAt', 'ASC']],
    },
    {
      model: db.Barcode, as: 'locationBarcode',
      attributes: ['id', 'barcode'],
      required: false,
      include: [
        { model: db.Location, as: 'location', attributes: ['id', 'name', 'description'], required: false },
        { model: db.Box, as: 'box', attributes: ['id', 'name', 'description'], required: false },
      ],
    },
    { ...outputTraceIncludes(), required: false },
  ];
}

// GET /
exports.getAll = async (req, res, next) => {
  try {
    const where = { activeFlag: true };
    if (req.query.status) {
      where.status = req.query.status;
    }

    const workOrders = await db.WorkOrder.findAll({
      where,
      include: [
        {
          model: db.EngineeringMaster, as: 'master',
          attributes: ['id', 'name', 'revision'],
        },
        {
          model: db.WorkOrderStepCompletion, as: 'stepCompletions',
          attributes: ['id'],
        },
        {
          model: db.Barcode, as: 'locationBarcode',
          attributes: ['id', 'barcode'],
          required: false,
          include: [
            { model: db.Location, as: 'location', attributes: ['id', 'name', 'description'], required: false },
            { model: db.Box, as: 'box', attributes: ['id', 'name', 'description'], required: false },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const result = await Promise.all(workOrders.map(async wo => {
      const totalSteps = await db.EngineeringMasterStep.count({
        where: { engineeringMasterID: wo.engineeringMasterID },
      });
      const json = wo.toJSON();
      json.completedSteps = json.stepCompletions.length;
      json.totalSteps = totalSteps;
      delete json.stepCompletions;
      return json;
    }));

    res.json(result);
  } catch (error) {
    next(createError(500, 'Failed to fetch work orders: ' + error.message));
  }
};

// GET /:id
exports.getById = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id, {
      include: workOrderIncludes(),
    });

    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }

    const json = wo.toJSON();
    // Sort steps by stepNumber
    if (json.master && json.master.steps) {
      json.master.steps.sort((a, b) => a.stepNumber - b.stepNumber);
      json.master.steps = json.master.steps.map(step => ({
        ...step,
        parts: (step.items || []).filter(i => !i.isTool),
        tooling: (step.items || []).filter(i => i.isTool),
        items: undefined,
      }));
    }

    res.json(json);
  } catch (error) {
    next(createError(500, 'Failed to fetch work order: ' + error.message));
  }
};

// POST /
exports.create = async (req, res, next) => {
  try {
    const { engineeringMasterID, quantity, locationBarcodeID } = req.body;

    const master = await db.EngineeringMaster.findByPk(engineeringMasterID, {
      include: [
        {
          model: db.EngineeringMasterOutputPart, as: 'outputParts',
          include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'defaultUnitOfMeasureID'] }],
        },
      ],
    });
    if (!master || !master.activeFlag) {
      return next(createError(404, 'Engineering Master not found'));
    }
    if (master.releaseState !== 'released') {
      return next(createError(400, 'Engineering Master must be in released state'));
    }

    // Validate location if provided
    if (locationBarcodeID) {
      const locationBarcode = await db.Barcode.findByPk(locationBarcodeID);
      if (!locationBarcode || !locationBarcode.activeFlag) {
        return next(createError(400, 'Location not found or inactive'));
      }
    }

    const woQty = quantity || 1;

    const wo = await db.WorkOrder.create({
      engineeringMasterID,
      quantity: woQty,
      status: 'not_started',
      createdByUserID: req.user.id,
      locationBarcodeID: locationBarcodeID || null,
    });

    // Create output traces for each output part
    const aklCategory = await db.BarcodeCategory.findOne({ where: { prefix: 'AKL' } });
    if (aklCategory && master.outputParts) {
      for (const op of master.outputParts) {
        const traceQty = woQty * Number(op.quantity);
        const barcode = await db.Barcode.create({
          barcodeCategoryID: aklCategory.id,
          parentBarcodeID: locationBarcodeID || 0,
          activeFlag: true,
        });

        await db.Trace.create({
          partID: op.partID,
          quantity: traceQty,
          unitOfMeasureID: op.part?.defaultUnitOfMeasureID || null,
          barcodeID: barcode.id,
          workOrderID: wo.id,
          activeFlag: true,
          wip: true,
        });

        // Record history
        const createdAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'CREATED' } });
        if (createdAction) {
          await db.BarcodeHistory.create({
            barcodeID: barcode.id,
            actionID: createdAction.id,
            qty: traceQty,
            userID: req.user.id,
          });
        }
      }
    }

    const result = await db.WorkOrder.findByPk(wo.id, { include: workOrderIncludes() });
    res.status(201).json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to create work order'));
  }
};

// DELETE /:id
exports.remove = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id);
    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }
    if (wo.status !== 'not_started') {
      return next(createError(400, 'Cannot delete a Work Order that has been started'));
    }

    // Deactivate output traces
    const traces = await db.Trace.findAll({ where: { workOrderID: wo.id } });
    for (const trace of traces) {
      await trace.update({ activeFlag: false });
      const barcode = await db.Barcode.findByPk(trace.barcodeID);
      if (barcode) await barcode.update({ activeFlag: false });
    }

    await wo.update({ activeFlag: false });
    res.json({ message: 'Work Order deleted' });
  } catch (error) {
    next(createError(500, 'Failed to delete work order: ' + error.message));
  }
};

// GET /:id/kit-status
exports.getKitStatus = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id, {
      include: [
        {
          model: db.EngineeringMaster, as: 'master',
          include: [
            {
              model: db.EngineeringMasterBomItem, as: 'bomItems',
              include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision'] }],
            },
            {
              model: db.EngineeringMasterStep, as: 'steps',
              include: [{
                model: db.EngineeringMasterStepItem, as: 'items',
                include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision'] }],
              }],
            },
          ],
        },
        outputTraceIncludes(),
      ],
    });

    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }

    // Aggregate BOM: union of stored bomItems and step items (same logic as frontend aggregatedBomItems)
    const storedBom = wo.master?.bomItems || [];
    const steps = wo.master?.steps || [];
    const bomMap = new Map(); // key: `${partID}-${isTool}` → { partID, part, quantity, isTool }

    // Add stored BOM items first (they take priority for quantity)
    for (const bi of storedBom) {
      const key = `${bi.partID}-${bi.isTool}`;
      bomMap.set(key, { partID: bi.partID, part: bi.part, quantity: Number(bi.quantity), isTool: bi.isTool });
    }

    // Add step items that aren't already in the stored BOM
    for (const step of steps) {
      for (const item of (step.items || [])) {
        const key = `${item.partID}-${item.isTool}`;
        if (!bomMap.has(key)) {
          bomMap.set(key, { partID: item.partID, part: item.part, quantity: Number(item.quantity), isTool: item.isTool });
        }
      }
    }

    const bomItems = Array.from(bomMap.values());
    const outputTraces = wo.outputTraces || [];

    // Get kitting history for all output traces (both KITTED and UNKITTED)
    const outputBarcodeIds = outputTraces.map(t => t.barcodeID);
    const kittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'KITTED' } });
    const unkittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'UNKITTED' } });
    const actionIDs = [kittedAction?.id, unkittedAction?.id].filter(Boolean);
    const kitHistory = outputBarcodeIds.length > 0 && actionIDs.length > 0 ? await db.BarcodeHistory.findAll({
      where: {
        barcodeID: outputBarcodeIds,
        actionID: actionIDs,
      },
      order: [['createdAt', 'ASC']],
    }) : [];

    // Compute kitted quantities per part AND track individual source traces
    // fromID = source barcode that was kitted INTO the output trace
    const kittedByPart = {};
    // Map: partID -> Map<sourceBarcodeID, { net qty kitted }>
    const kittedTracesByPart = {};
    for (const h of kitHistory) {
      const sourceBarcodeID = h.actionID === kittedAction?.id ? h.fromID : h.toID;
      if (!sourceBarcodeID) continue;
      const sourceTrace = await db.Trace.findOne({
        where: { barcodeID: sourceBarcodeID },
        attributes: ['partID', 'activeFlag'],
        include: [{ model: db.Barcode, attributes: ['id', 'barcode', 'activeFlag'] }],
      });
      if (!sourceTrace) continue;

      const partID = sourceTrace.partID;
      if (!kittedByPart[partID]) kittedByPart[partID] = 0;
      if (!kittedTracesByPart[partID]) kittedTracesByPart[partID] = {};
      if (!kittedTracesByPart[partID][sourceBarcodeID]) {
        kittedTracesByPart[partID][sourceBarcodeID] = {
          barcodeID: sourceBarcodeID,
          barcode: sourceTrace.Barcode?.barcode,
          qty: 0,
          traceActiveFlag: sourceTrace.activeFlag,
          barcodeActiveFlag: sourceTrace.Barcode?.activeFlag ?? false,
        };
      }

      const qty = Number(h.qty || 0);
      if (h.actionID === kittedAction?.id) {
        kittedByPart[partID] += qty;
        kittedTracesByPart[partID][sourceBarcodeID].qty += qty;
      } else {
        kittedByPart[partID] -= qty;
        kittedTracesByPart[partID][sourceBarcodeID].qty -= qty;
      }
    }

    const bomStatus = bomItems.map(bi => {
      const partTraces = kittedTracesByPart[bi.partID] || {};
      // Only include traces with positive net kitted qty
      const kittedTraces = Object.values(partTraces).filter(t => t.qty > 0);
      return {
        partID: bi.partID,
        partName: bi.part?.name,
        partRevision: bi.part?.revision,
        isTool: bi.isTool,
        required: Number(bi.quantity) * wo.quantity,
        kitted: kittedByPart[bi.partID] || 0,
        status: (kittedByPart[bi.partID] || 0) >= Number(bi.quantity) * wo.quantity ? 'complete' : 'partial',
        kittedTraces,
      };
    });

    res.json({
      workOrderID: wo.id,
      outputTraces: outputTraces.map(t => ({
        barcodeID: t.barcodeID,
        barcode: t.Barcode?.barcode,
        partID: t.partID,
        partName: t.Part?.name,
        quantity: t.quantity,
      })),
      bomStatus,
      overallStatus: bomStatus.length === 0 || bomStatus.every(b => b.status === 'complete') ? 'complete' : 'partial',
    });
  } catch (error) {
    next(createError(500, 'Failed to get kit status: ' + error.message));
  }
};

// POST /:id/complete-step
exports.completeStep = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id);
    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }

    const { stepID } = req.body;

    const step = await db.EngineeringMasterStep.findByPk(stepID);
    if (!step || step.engineeringMasterID !== wo.engineeringMasterID) {
      return next(createError(400, 'Step does not belong to this Work Order\'s master'));
    }

    const existing = await db.WorkOrderStepCompletion.findOne({
      where: { workOrderID: wo.id, stepID },
    });
    if (existing) {
      return next(createError(400, 'Step already completed'));
    }

    const allSteps = await db.EngineeringMasterStep.findAll({
      where: { engineeringMasterID: wo.engineeringMasterID },
      order: [['stepNumber', 'ASC']],
    });
    const completions = await db.WorkOrderStepCompletion.findAll({
      where: { workOrderID: wo.id },
    });
    const completedStepIDs = new Set(completions.map(c => c.stepID));

    for (const s of allSteps) {
      if (s.id === stepID) break;
      if (!completedStepIDs.has(s.id)) {
        return next(createError(400, 'Previous step must be completed first'));
      }
    }

    const completion = await db.WorkOrderStepCompletion.create({
      workOrderID: wo.id,
      stepID,
      completedByUserID: req.user.id,
      completedAt: new Date(),
      createdAt: new Date(),
    });

    if (wo.status === 'not_started') {
      await wo.update({ status: 'in_progress' });
    }

    const result = await db.WorkOrderStepCompletion.findByPk(completion.id, {
      include: [{ model: db.User, as: 'completedBy', attributes: ['id', 'displayName'] }],
    });
    res.json(result);
  } catch (error) {
    next(createError(500, 'Failed to complete step: ' + error.message));
  }
};

// POST /:id/uncomplete-step
exports.uncompleteStep = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id);
    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }

    const { stepID } = req.body;

    const completions = await db.WorkOrderStepCompletion.findAll({
      where: { workOrderID: wo.id },
      order: [['completedAt', 'DESC']],
    });

    if (completions.length === 0) {
      return next(createError(400, 'No steps have been completed'));
    }

    if (completions[0].stepID !== stepID) {
      return next(createError(400, 'Can only uncomplete the most recently completed step'));
    }

    await completions[0].destroy();

    if (completions.length === 1) {
      await wo.update({ status: 'not_started' });
    }

    res.json({ message: 'Step completion removed' });
  } catch (error) {
    next(createError(500, 'Failed to uncomplete step: ' + error.message));
  }
};

// POST /:id/complete
exports.complete = async (req, res, next) => {
  try {
    const wo = await db.WorkOrder.findByPk(req.params.id);
    if (!wo || !wo.activeFlag) {
      return next(createError(404, 'Work Order not found'));
    }

    const totalSteps = await db.EngineeringMasterStep.count({
      where: { engineeringMasterID: wo.engineeringMasterID },
    });
    const completedSteps = await db.WorkOrderStepCompletion.count({
      where: { workOrderID: wo.id },
    });

    if (completedSteps < totalSteps) {
      return next(createError(400, 'All steps must be completed first'));
    }

    await wo.update({ status: 'complete', completedAt: new Date() });

    // Clear WIP flag on output traces
    await db.Trace.update({ wip: false }, { where: { workOrderID: wo.id } });

    const result = await db.WorkOrder.findByPk(wo.id, { include: workOrderIncludes() });
    res.json(result);
  } catch (error) {
    next(createError(500, 'Failed to complete work order: ' + error.message));
  }
};
