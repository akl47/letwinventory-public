const db = require('../../../models');
const createError = require('http-errors');

/**
 * Validate that a quantity is an integer when the UoM does not allow decimals.
 * Returns an error message string if invalid, null if valid.
 */
async function validateQuantityForUoM(quantity, unitOfMeasureID) {
  if (!unitOfMeasureID) return null;
  const uom = await db.UnitOfMeasure.findByPk(unitOfMeasureID);
  if (!uom || uom.allowDecimal) return null;
  if (!Number.isInteger(quantity)) {
    return `Quantity must be a whole number for unit "${uom.name}"`;
  }
  return null;
}


exports.createNewTrace = async (req, res, next) => {
  try {
    const barcodeCategory = await db.BarcodeCategory.findOne({
      where: { activeFlag: true, prefix: "AKL" }
    });

    if (!barcodeCategory) {
      return next(createError(500, 'Error Finding Barcode Category'));
    }

    const barcode = await db.Barcode.create({
      barcodeCategoryID: barcodeCategory.dataValues.id,
      parentBarcodeID: req.body.parentBarcodeID,
    });

    const barcodeData = barcode.toJSON();
    req.body.barcodeID = barcodeData.id;

    // Record barcode creation in history
    // Use RECEIVED action type when orderItemID is provided (receiving from an order)
    // Otherwise use CREATED action type
    try {
      const actionCode = req.body.orderItemID ? 'RECEIVED' : 'CREATED';
      const historyAction = await db.BarcodeHistoryActionType.findOne({
        where: { code: actionCode, activeFlag: true }
      });

      if (historyAction) {
        const historyData = {
          barcodeID: barcodeData.id,
          userID: req.user ? req.user.id : null,
          actionID: historyAction.id,
          fromID: null,
          toID: req.body.parentBarcodeID || null,
          qty: req.body.quantity || null,
          serialNumber: req.body.serialNumber || null,
          lotNumber: req.body.lotNumber || null,
          unitOfMeasureID: req.body.unitOfMeasureID || null
        };
        console.log(`Creating barcode history with ${actionCode} action:`, historyData);
        const historyRecord = await db.BarcodeHistory.create(historyData);
        console.log('Barcode history created:', historyRecord.toJSON());
      } else {
        console.warn(`${actionCode} action type not found in BarcodeHistoryActionTypes`);
      }
    } catch (historyError) {
      console.error('Error recording barcode history:', historyError);
    }

    // Validate quantity for UoM
    const qtyError = await validateQuantityForUoM(req.body.quantity, req.body.unitOfMeasureID);
    if (qtyError) return next(createError(400, qtyError));

    const trace = await db.Trace.create(req.body);

    // Fetch the trace with Barcode association to return barcode string
    const traceWithBarcode = await db.Trace.findOne({
      where: { id: trace.id },
      include: [{
        model: db.Barcode,
        attributes: ['id', 'barcode']
      }]
    });

    res.json(traceWithBarcode);
  } catch (error) {
    next(createError(500, 'Error Creating Trace: ' + error.message));
  }
}

exports.getTraceByID = (req, res, next) => {
  db.Trace.findOne({
    where: {
      id: req.params.id,
      activeFlag: true
    }
  }).then(trace => {
    res.json(trace)
  }).catch(error => {
    next(createError(500, 'Error Finding Trace:' + error))
  })
}

exports.getTracesByPartID = (req, res, next) => {
  db.Trace.findAll({
    where: {
      partID: req.query.partID,
      activeFlag: true
    },
    include: { all: true },
  }).then(trace => {
    res.json(trace)
  }).catch(error => {
    next(createError(500, 'Error Finding Trace:' + error))
  })
}

exports.updateTrace = (req, res, next) => {
  db.Trace.update(req.body, {
    where: { id: req.params.id },
    returning: true
  }).then(updated => {
    res.json(updated[1])
  }).catch(error => {
    next(createError(500, 'Error Updating Trace:' + error))
  })
}

/**
 * Split a trace into two traces
 * Takes a quantity from the source trace and creates a new trace with that quantity
 */
exports.splitTrace = async (req, res, next) => {
  const { splitQuantity } = req.body;
  const barcodeID = parseInt(req.params.barcodeId);

  try {
    // Find the source trace
    const sourceTrace = await db.Trace.findOne({
      where: { barcodeID, activeFlag: true },
      include: [{ model: db.Barcode }]
    });

    if (!sourceTrace) {
      return next(createError(404, 'Source trace not found'));
    }

    const sourceData = sourceTrace.toJSON();

    if (splitQuantity >= sourceData.quantity) {
      return next(createError(400, 'Split quantity must be less than current quantity'));
    }

    if (splitQuantity <= 0) {
      return next(createError(400, 'Split quantity must be greater than 0'));
    }

    // Validate quantity for UoM
    const splitQtyError = await validateQuantityForUoM(splitQuantity, sourceData.unitOfMeasureID);
    if (splitQtyError) return next(createError(400, splitQtyError));
    const remainderError = await validateQuantityForUoM(sourceData.quantity - splitQuantity, sourceData.unitOfMeasureID);
    if (remainderError) return next(createError(400, remainderError));

    // Get trace barcode category
    const barcodeCategory = await db.BarcodeCategory.findOne({
      where: { activeFlag: true, prefix: "AKL" }
    });

    if (!barcodeCategory) {
      return next(createError(500, 'Trace barcode category not found'));
    }

    // Create new barcode for the split trace
    const newBarcode = await db.Barcode.create({
      barcodeCategoryID: barcodeCategory.id,
      parentBarcodeID: sourceData.Barcode.parentBarcodeID
    });

    // Create the new trace with split quantity
    const newTrace = await db.Trace.create({
      partID: sourceData.partID,
      quantity: splitQuantity,
      unitOfMeasureID: sourceData.unitOfMeasureID,
      barcodeID: newBarcode.id,
      serialNumber: sourceData.serialNumber,
      lotNumber: sourceData.lotNumber
    });

    // Update source trace quantity
    const newSourceQuantity = sourceData.quantity - splitQuantity;
    await sourceTrace.update({ quantity: newSourceQuantity });

    // Record split in history for source barcode
    const splitAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'SPLIT', activeFlag: true }
    });

    if (splitAction) {
      // History for source (quantity reduced)
      await db.BarcodeHistory.create({
        barcodeID: barcodeID,
        userID: req.user ? req.user.id : null,
        actionID: splitAction.id,
        fromID: barcodeID,
        toID: newBarcode.id,
        qty: newSourceQuantity,
        serialNumber: sourceData.serialNumber,
        lotNumber: sourceData.lotNumber,
        unitOfMeasureID: sourceData.unitOfMeasureID
      });

      // History for new barcode (created from split)
      await db.BarcodeHistory.create({
        barcodeID: newBarcode.id,
        userID: req.user ? req.user.id : null,
        actionID: splitAction.id,
        fromID: barcodeID,
        toID: newBarcode.id,
        qty: splitQuantity,
        serialNumber: sourceData.serialNumber,
        lotNumber: sourceData.lotNumber,
        unitOfMeasureID: sourceData.unitOfMeasureID
      });
    }

    res.json({
      message: 'Trace split successfully',
      sourceTrace: {
        barcodeID: barcodeID,
        newQuantity: newSourceQuantity
      },
      newTrace: {
        barcodeID: newBarcode.id,
        barcode: newBarcode.barcode,
        quantity: splitQuantity
      }
    });
  } catch (error) {
    next(createError(500, 'Error splitting trace: ' + error.message));
  }
}

/**
 * Merge two traces of the same part together
 * Combines quantities and deactivates the source trace
 */
exports.mergeTrace = async (req, res, next) => {
  const { mergeBarcodeId } = req.body;
  const targetBarcodeID = parseInt(req.params.barcodeId);

  try {
    // Find target trace (the one we're merging into)
    const targetTrace = await db.Trace.findOne({
      where: { barcodeID: targetBarcodeID, activeFlag: true }
    });

    if (!targetTrace) {
      return next(createError(404, 'Target trace not found'));
    }

    // Find source trace (the one being merged)
    const sourceTrace = await db.Trace.findOne({
      where: { barcodeID: mergeBarcodeId, activeFlag: true }
    });

    if (!sourceTrace) {
      return next(createError(404, 'Source trace not found'));
    }

    const targetData = targetTrace.toJSON();
    const sourceData = sourceTrace.toJSON();

    // Verify same part
    if (targetData.partID !== sourceData.partID) {
      return next(createError(400, 'Cannot merge traces of different parts'));
    }

    // Calculate new quantity
    const newQuantity = targetData.quantity + sourceData.quantity;

    // Update target trace with combined quantity
    await targetTrace.update({ quantity: newQuantity });

    // Deactivate source trace and its barcode
    await sourceTrace.update({ activeFlag: false });
    await db.Barcode.update(
      { activeFlag: false },
      { where: { id: mergeBarcodeId } }
    );

    // Record merge in history
    const mergedAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'MERGED', activeFlag: true }
    });

    if (mergedAction) {
      // History for target (received merge)
      await db.BarcodeHistory.create({
        barcodeID: targetBarcodeID,
        userID: req.user ? req.user.id : null,
        actionID: mergedAction.id,
        fromID: mergeBarcodeId,
        toID: targetBarcodeID,
        qty: newQuantity,
        serialNumber: targetData.serialNumber,
        lotNumber: targetData.lotNumber,
        unitOfMeasureID: targetData.unitOfMeasureID
      });

      // History for source (was merged)
      await db.BarcodeHistory.create({
        barcodeID: mergeBarcodeId,
        userID: req.user ? req.user.id : null,
        actionID: mergedAction.id,
        fromID: mergeBarcodeId,
        toID: targetBarcodeID,
        qty: sourceData.quantity,
        serialNumber: sourceData.serialNumber,
        lotNumber: sourceData.lotNumber,
        unitOfMeasureID: sourceData.unitOfMeasureID
      });
    }

    res.json({
      message: 'Traces merged successfully',
      targetTrace: {
        barcodeID: targetBarcodeID,
        newQuantity: newQuantity
      },
      mergedBarcodeID: mergeBarcodeId
    });
  } catch (error) {
    next(createError(500, 'Error merging traces: ' + error.message));
  }
}

/**
 * Adjust the quantity of a trace directly, with audit trail
 */
exports.adjustQuantity = async (req, res, next) => {
  const barcodeID = parseInt(req.params.barcodeId);
  const { newQuantity, reason } = req.body;

  try {
    if (!newQuantity || newQuantity <= 0) {
      return next(createError(400, 'New quantity must be greater than 0'));
    }

    const trace = await db.Trace.findOne({
      where: { barcodeID, activeFlag: true },
      include: [{ model: db.Barcode }]
    });

    if (!trace) {
      return next(createError(404, 'Trace not found'));
    }

    const traceData = trace.toJSON();
    const oldQuantity = traceData.quantity;

    // Validate quantity for UoM
    const adjQtyError = await validateQuantityForUoM(newQuantity, traceData.unitOfMeasureID);
    if (adjQtyError) return next(createError(400, adjQtyError));

    if (newQuantity === oldQuantity) {
      return next(createError(400, 'New quantity is the same as current quantity'));
    }

    await trace.update({ quantity: newQuantity });

    // Record in history
    const adjustedAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'ADJUSTED', activeFlag: true }
    });

    if (adjustedAction) {
      await db.BarcodeHistory.create({
        barcodeID: traceData.barcodeID,
        userID: req.user ? req.user.id : null,
        actionID: adjustedAction.id,
        fromID: traceData.barcodeID,
        toID: null,
        qty: newQuantity,
        serialNumber: traceData.serialNumber,
        lotNumber: traceData.lotNumber,
        unitOfMeasureID: traceData.unitOfMeasureID
      });
    }

    res.json({
      message: 'Quantity adjusted successfully',
      barcodeID: barcodeID,
      oldQuantity: oldQuantity,
      newQuantity: newQuantity,
      reason: reason || null
    });
  } catch (error) {
    next(createError(500, 'Error adjusting quantity: ' + error.message));
  }
}

/**
 * Kit a source trace to a target kit/assembly trace.
 * Deducts quantity from source, records KITTED history on both.
 */
exports.kitTrace = async (req, res, next) => {
  const sourceBarcodeID = parseInt(req.params.barcodeId);
  const { targetBarcodeId, quantity } = req.body;

  try {
    if (!targetBarcodeId || !quantity || quantity <= 0) {
      return next(createError(400, 'targetBarcodeId and positive quantity are required'));
    }

    // Find source trace
    const sourceTrace = await db.Trace.findOne({
      where: { barcodeID: sourceBarcodeID, activeFlag: true },
      include: [{ model: db.Barcode }]
    });
    if (!sourceTrace) {
      return next(createError(404, 'Source trace not found'));
    }

    if (quantity > sourceTrace.quantity) {
      return next(createError(400, 'Insufficient quantity'));
    }

    // Validate quantity for UoM
    const kitQtyError = await validateQuantityForUoM(quantity, sourceTrace.unitOfMeasureID);
    if (kitQtyError) return next(createError(400, kitQtyError));

    // Find target trace and verify it's a kit/assembly
    const targetTrace = await db.Trace.findOne({
      where: { barcodeID: targetBarcodeId, activeFlag: true },
      include: [
        { model: db.Barcode },
        {
          model: db.Part,
          include: [{ model: db.PartCategory, attributes: ['name'] }]
        }
      ]
    });
    if (!targetTrace) {
      return next(createError(404, 'Target trace not found'));
    }

    const targetCategoryName = targetTrace.Part?.PartCategory?.name;
    if (targetCategoryName !== 'Kit' && targetCategoryName !== 'Assembly') {
      return next(createError(400, 'Target trace is not a Kit or Assembly'));
    }

    // Deduct from source
    const newSourceQty = sourceTrace.quantity - quantity;
    await sourceTrace.update({
      quantity: newSourceQty,
      activeFlag: newSourceQty > 0
    });
    if (newSourceQty <= 0) {
      await db.Barcode.update({ activeFlag: false }, { where: { id: sourceBarcodeID } });
    }

    // Record KITTED history on both
    const kittedAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'KITTED', activeFlag: true }
    });

    let sourceHistory, targetHistory;
    if (kittedAction) {
      sourceHistory = await db.BarcodeHistory.create({
        barcodeID: sourceBarcodeID,
        userID: req.user ? req.user.id : null,
        actionID: kittedAction.id,
        fromID: sourceBarcodeID,
        toID: targetBarcodeId,
        qty: quantity,
        unitOfMeasureID: sourceTrace.unitOfMeasureID
      });
      targetHistory = await db.BarcodeHistory.create({
        barcodeID: targetBarcodeId,
        userID: req.user ? req.user.id : null,
        actionID: kittedAction.id,
        fromID: sourceBarcodeID,
        toID: targetBarcodeId,
        qty: quantity,
        unitOfMeasureID: sourceTrace.unitOfMeasureID
      });
    }

    res.json({
      sourceTrace: { id: sourceTrace.id, quantity: newSourceQty, barcodeID: sourceBarcodeID, activeFlag: newSourceQty > 0 },
      targetTrace: { id: targetTrace.id, barcodeID: targetBarcodeId },
      sourceHistory,
      targetHistory
    });
  } catch (error) {
    next(createError(500, 'Error kitting trace: ' + error.message));
  }
};

/**
 * Unkit: reverse a kitting operation.
 * barcodeId = kit/assembly trace, targetBarcodeId = source trace to return qty to.
 */
exports.unkitTrace = async (req, res, next) => {
  const kitBarcodeID = parseInt(req.params.barcodeId);
  const { targetBarcodeId, quantity } = req.body;

  try {
    if (!targetBarcodeId || !quantity || quantity <= 0) {
      return next(createError(400, 'targetBarcodeId and positive quantity are required'));
    }

    // Find kit trace and verify it's a kit/assembly
    const kitTrace = await db.Trace.findOne({
      where: { barcodeID: kitBarcodeID, activeFlag: true },
      include: [
        { model: db.Barcode },
        {
          model: db.Part,
          include: [{ model: db.PartCategory, attributes: ['name'] }]
        }
      ]
    });
    if (!kitTrace) {
      return next(createError(404, 'Kit trace not found'));
    }

    const kitCategoryName = kitTrace.Part?.PartCategory?.name;
    if (kitCategoryName !== 'Kit' && kitCategoryName !== 'Assembly') {
      return next(createError(400, 'Source trace is not a Kit or Assembly'));
    }

    // Find target trace (may be inactive if it was fully consumed)
    let sourceTrace = await db.Trace.findOne({
      where: { barcodeID: targetBarcodeId },
      include: [{ model: db.Barcode }]
    });
    if (!sourceTrace) {
      return next(createError(404, 'Target trace not found'));
    }

    // Validate quantity for UoM
    const unkitQtyError = await validateQuantityForUoM(quantity, sourceTrace.unitOfMeasureID);
    if (unkitQtyError) return next(createError(400, unkitQtyError));

    // Restore quantity and reactivate if needed
    const newSourceQty = sourceTrace.quantity + quantity;
    await sourceTrace.update({ quantity: newSourceQty, activeFlag: true });
    await db.Barcode.update({ activeFlag: true }, { where: { id: targetBarcodeId } });

    // Record UNKITTED history on both
    const unkittedAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'UNKITTED', activeFlag: true }
    });

    let kitHistory, sourceHistory;
    if (unkittedAction) {
      kitHistory = await db.BarcodeHistory.create({
        barcodeID: kitBarcodeID,
        userID: req.user ? req.user.id : null,
        actionID: unkittedAction.id,
        fromID: kitBarcodeID,
        toID: targetBarcodeId,
        qty: quantity,
        unitOfMeasureID: sourceTrace.unitOfMeasureID
      });
      sourceHistory = await db.BarcodeHistory.create({
        barcodeID: targetBarcodeId,
        userID: req.user ? req.user.id : null,
        actionID: unkittedAction.id,
        fromID: kitBarcodeID,
        toID: targetBarcodeId,
        qty: quantity,
        unitOfMeasureID: sourceTrace.unitOfMeasureID
      });
    }

    res.json({
      kitTrace: { id: kitTrace.id, barcodeID: kitBarcodeID },
      sourceTrace: { id: sourceTrace.id, quantity: newSourceQty, barcodeID: targetBarcodeId, activeFlag: true },
      kitHistory,
      sourceHistory
    });
  } catch (error) {
    next(createError(500, 'Error unkitting trace: ' + error.message));
  }
};

/**
 * Get kit/assembly fulfillment status.
 * Computes kitted quantities per BOM line from KITTED/UNKITTED history.
 */
exports.getKitStatus = async (req, res, next) => {
  const barcodeID = parseInt(req.params.barcodeId);

  try {
    // Find trace and verify it's a kit/assembly
    const trace = await db.Trace.findOne({
      where: { barcodeID, activeFlag: true },
      include: [
        { model: db.Barcode },
        {
          model: db.Part,
          include: [
            { model: db.PartCategory, attributes: ['name'] },
            {
              model: db.BillOfMaterialItem,
              as: 'bomItems',
              where: { activeFlag: true },
              required: false,
              include: [{
                model: db.Part,
                as: 'componentPart',
                attributes: ['id', 'name', 'revision']
              }]
            }
          ]
        }
      ]
    });

    if (!trace) {
      return next(createError(404, 'Trace not found'));
    }

    const categoryName = trace.Part?.PartCategory?.name;
    if (categoryName !== 'Kit' && categoryName !== 'Assembly') {
      return next(createError(400, 'Trace is not a Kit or Assembly'));
    }

    const bomItems = trace.Part?.bomItems || [];

    // Get all KITTED and UNKITTED history for this barcode
    const kittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'KITTED' } });
    const unkittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'UNKITTED' } });

    const actionIDs = [kittedAction?.id, unkittedAction?.id].filter(Boolean);
    const history = actionIDs.length > 0 ? await db.BarcodeHistory.findAll({
      where: {
        barcodeID,
        actionID: actionIDs
      }
    }) : [];

    // Calculate kitted quantities per part
    const kittedByPart = {};
    for (const entry of history) {
      // For KITTED: fromID is the source barcode (the part being kitted in)
      // For UNKITTED: toID is the source barcode (the part being returned to)
      const sourceBarcodeID = entry.actionID === kittedAction?.id ? entry.fromID : entry.toID;
      const sourceTrace = await db.Trace.findOne({
        where: { barcodeID: sourceBarcodeID },
        attributes: ['partID']
      });
      if (!sourceTrace) continue;

      const partID = sourceTrace.partID;
      if (!kittedByPart[partID]) kittedByPart[partID] = 0;

      if (entry.actionID === kittedAction?.id) {
        kittedByPart[partID] += entry.qty || 0;
      } else if (entry.actionID === unkittedAction?.id) {
        kittedByPart[partID] -= entry.qty || 0;
      }
    }

    // Build status per BOM line
    const bomLines = bomItems.map(item => ({
      partID: item.componentPartID,
      partName: item.componentPart?.name || `Part ${item.componentPartID}`,
      partRevision: item.componentPart?.revision,
      requiredQty: item.quantity,
      kittedQty: kittedByPart[item.componentPartID] || 0
    }));

    const status = bomLines.length === 0
      ? 'complete'
      : bomLines.every(l => l.kittedQty >= l.requiredQty) ? 'complete' : 'partial';

    res.json({ status, bomLines });
  } catch (error) {
    next(createError(500, 'Error getting kit status: ' + error.message));
  }
};

/**
 * Get all in-progress (partial) kit/assembly builds.
 * Returns traces whose part category is Kit or Assembly, with BOM progress.
 */
exports.getInProgressBuilds = async (req, res, next) => {
  try {
    const includeCompleted = req.query.includeCompleted === 'true';
    const KIT_ASSEMBLY_NAMES = ['Kit', 'Assembly'];

    // Find all active traces for kit/assembly parts
    const traces = await db.Trace.findAll({
      where: { activeFlag: true },
      include: [
        {
          model: db.Part,
          required: true,
          include: [
            {
              model: db.PartCategory,
              where: { name: KIT_ASSEMBLY_NAMES },
              attributes: ['id', 'name', 'tagColorHex']
            },
            {
              model: db.BillOfMaterialItem,
              as: 'bomItems',
              where: { activeFlag: true },
              required: false,
              attributes: ['id', 'componentPartID', 'quantity']
            }
          ]
        },
        {
          model: db.Barcode,
          attributes: ['id', 'barcode']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // For each trace, compute kit status
    const kittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'KITTED' } });
    const unkittedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'UNKITTED' } });
    const actionIDs = [kittedAction?.id, unkittedAction?.id].filter(Boolean);

    const builds = [];
    for (const trace of traces) {
      const traceData = trace.toJSON();
      const bomItems = traceData.Part?.bomItems || [];
      const bomTotal = bomItems.length;

      // Get kitting history for this trace
      const history = actionIDs.length > 0 ? await db.BarcodeHistory.findAll({
        where: { barcodeID: traceData.barcodeID, actionID: actionIDs }
      }) : [];

      // Calculate kitted quantities per part
      const kittedByPart = {};
      for (const entry of history) {
        const sourceBarcodeID = entry.actionID === kittedAction?.id ? entry.fromID : entry.toID;
        const sourceTrace = await db.Trace.findOne({
          where: { barcodeID: sourceBarcodeID },
          attributes: ['partID']
        });
        if (!sourceTrace) continue;
        const partID = sourceTrace.partID;
        if (!kittedByPart[partID]) kittedByPart[partID] = 0;
        if (entry.actionID === kittedAction?.id) {
          kittedByPart[partID] += entry.qty || 0;
        } else {
          kittedByPart[partID] -= entry.qty || 0;
        }
      }

      // Count fulfilled BOM lines
      let bomFulfilled = 0;
      for (const item of bomItems) {
        if ((kittedByPart[item.componentPartID] || 0) >= item.quantity) {
          bomFulfilled++;
        }
      }

      const status = bomTotal === 0 ? 'complete' : (bomFulfilled === bomTotal ? 'complete' : 'partial');

      if (includeCompleted || status === 'partial') {
        builds.push({
          id: traceData.id,
          barcodeID: traceData.barcodeID,
          barcode: traceData.Barcode?.barcode,
          partID: traceData.partID,
          partName: traceData.Part?.name,
          partRevision: traceData.Part?.revision,
          categoryName: traceData.Part?.PartCategory?.name,
          categoryColor: traceData.Part?.PartCategory?.tagColorHex,
          status,
          bomTotal,
          bomFulfilled,
          createdAt: traceData.createdAt
        });
      }
    }

    res.json(builds);
  } catch (error) {
    next(createError(500, 'Error getting in-progress builds: ' + error.message));
  }
};

/**
 * Delete a trace - either reduce quantity or deactivate entirely
 */
exports.deleteTrace = async (req, res, next) => {
  const barcodeID = parseInt(req.params.barcodeId);
  const { deleteQuantity } = req.body; // If null/undefined, delete entire trace

  try {
    const trace = await db.Trace.findOne({
      where: { barcodeID, activeFlag: true }
    });

    if (!trace) {
      return next(createError(404, 'Trace not found'));
    }

    const traceData = trace.toJSON();

    // Get deleted action type for history
    const deletedAction = await db.BarcodeHistoryActionType.findOne({
      where: { code: 'DELETED', activeFlag: true }
    });

    if (deleteQuantity !== null && deleteQuantity !== undefined) {
      // Partial deletion - reduce quantity
      if (deleteQuantity >= traceData.quantity) {
        return next(createError(400, 'Delete quantity must be less than current quantity. Use full delete to remove entirely.'));
      }

      if (deleteQuantity <= 0) {
        return next(createError(400, 'Delete quantity must be greater than 0'));
      }

      // Validate quantity for UoM
      const delQtyError = await validateQuantityForUoM(deleteQuantity, traceData.unitOfMeasureID);
      if (delQtyError) return next(createError(400, delQtyError));

      const newQuantity = traceData.quantity - deleteQuantity;
      await trace.update({ quantity: newQuantity });

      // Record in history
      if (deletedAction) {
        await db.BarcodeHistory.create({
          barcodeID: barcodeID,
          userID: req.user ? req.user.id : null,
          actionID: deletedAction.id,
          fromID: barcodeID,
          toID: null,
          qty: newQuantity,
          serialNumber: traceData.serialNumber,
          lotNumber: traceData.lotNumber,
          unitOfMeasureID: traceData.unitOfMeasureID
        });
      }

      res.json({
        message: 'Quantity reduced successfully',
        barcodeID: barcodeID,
        deletedQuantity: deleteQuantity,
        remainingQuantity: newQuantity
      });
    } else {
      // Full deletion - deactivate trace and barcode
      await trace.update({ activeFlag: false });
      await db.Barcode.update(
        { activeFlag: false },
        { where: { id: barcodeID } }
      );

      // Record in history
      if (deletedAction) {
        await db.BarcodeHistory.create({
          barcodeID: barcodeID,
          userID: req.user ? req.user.id : null,
          actionID: deletedAction.id,
          fromID: barcodeID,
          toID: null,
          qty: 0,
          serialNumber: traceData.serialNumber,
          lotNumber: traceData.lotNumber,
          unitOfMeasureID: traceData.unitOfMeasureID
        });
      }

      res.json({
        message: 'Trace deleted successfully',
        barcodeID: barcodeID
      });
    }
  } catch (error) {
    next(createError(500, 'Error deleting trace: ' + error.message));
  }
}