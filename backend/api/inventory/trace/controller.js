const db = require('../../../models');
const createError = require('http-errors');


exports.createNewTrace = async (req, res, next) => {
  console.log("Create New Trace")
  console.log(req.body)

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
    console.log("Get Trace by part id")
    console.log(trace)
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