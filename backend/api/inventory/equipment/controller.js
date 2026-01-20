const db = require('../../../models');
const createError = require('http-errors');

exports.getAllEquipment = async (req, res, next) => {
  try {
    const equipment = await db.Equipment.findAll({
      order: [['name', 'asc']],
      include: [
        {
          model: db.Barcode,
          attributes: ['id', 'barcode'],
          include: [{
            model: db.BarcodeCategory,
            attributes: ['prefix']
          }]
        }
      ]
    });
    res.json(equipment);
  } catch (error) {
    next(createError(500, 'Error Getting Equipment: ' + error));
  }
};

exports.getEquipmentByID = async (req, res, next) => {
  try {
    const equipment = await db.Equipment.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      },
      include: [
        {
          model: db.Barcode,
          attributes: ['id', 'barcode']
        }
      ]
    });
    if (!equipment) {
      return next(createError(404, 'Equipment not found'));
    }
    res.json(equipment);
  } catch (error) {
    next(createError(500, 'Error Getting Equipment: ' + error));
  }
};

exports.createNewEquipment = async (req, res, next) => {
  try {
    // Find the EQP barcode category
    const barcodeCategory = await db.BarcodeCategory.findOne({
      where: {
        activeFlag: true,
        prefix: 'EQP'
      }
    });

    if (!barcodeCategory) {
      return next(createError(500, 'Equipment barcode category not found. Please run the seeder.'));
    }

    // Create the barcode
    const barcode = await db.Barcode.create({
      barcodeCategoryID: barcodeCategory.id,
      parentBarcodeID: 0 // Equipment doesn't have a parent by default
    });

    // Create the equipment
    const equipment = await db.Equipment.create({
      name: req.body.name,
      description: req.body.description,
      serialNumber: req.body.serialNumber,
      commissionDate: req.body.commissionDate,
      barcodeID: barcode.id
    });

    // Fetch with barcode included
    const result = await db.Equipment.findByPk(equipment.id, {
      include: [{
        model: db.Barcode,
        attributes: ['id', 'barcode']
      }]
    });

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Creating Equipment: ' + error));
  }
};

exports.updateEquipmentByID = async (req, res, next) => {
  try {
    const [updateCount, updatedRows] = await db.Equipment.update({
      name: req.body.name,
      description: req.body.description,
      serialNumber: req.body.serialNumber,
      commissionDate: req.body.commissionDate
    }, {
      where: { id: req.params.id },
      returning: true
    });

    if (updateCount === 0) {
      return next(createError(404, 'Equipment not found'));
    }

    // Fetch with barcode included
    const result = await db.Equipment.findByPk(req.params.id, {
      include: [{
        model: db.Barcode,
        attributes: ['id', 'barcode']
      }]
    });

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Updating Equipment: ' + error));
  }
};

// Receive equipment from an order - creates equipment with barcode and history
exports.receiveEquipment = async (req, res, next) => {
  try {
    const { name, description, serialNumber, commissionDate, parentBarcodeID, orderItemID, partID } = req.body;

    // Find the EQP barcode category
    const barcodeCategory = await db.BarcodeCategory.findOne({
      where: {
        activeFlag: true,
        prefix: 'EQP'
      }
    });

    if (!barcodeCategory) {
      return next(createError(500, 'Equipment barcode category not found. Please run the seeder.'));
    }

    // Create the barcode with parent location
    const barcode = await db.Barcode.create({
      barcodeCategoryID: barcodeCategory.id,
      parentBarcodeID: parentBarcodeID || 0
    });

    // Create the equipment with optional partID and orderItemID links
    const equipment = await db.Equipment.create({
      name,
      description,
      serialNumber,
      commissionDate,
      barcodeID: barcode.id,
      partID: partID || null,
      orderItemID: orderItemID || null
    });

    // Record barcode history with RECEIVED action
    try {
      const historyAction = await db.BarcodeHistoryActionType.findOne({
        where: { code: 'RECEIVED', activeFlag: true }
      });

      if (historyAction) {
        await db.BarcodeHistory.create({
          barcodeID: barcode.id,
          userID: req.user ? req.user.id : null,
          actionID: historyAction.id,
          fromID: null,
          toID: parentBarcodeID || null,
          qty: 1,
          serialNumber: serialNumber || null,
          lotNumber: null,
          unitOfMeasureID: null
        });
      }
    } catch (historyError) {
      console.error('Error recording barcode history:', historyError);
    }

    // Fetch with barcode included
    const result = await db.Equipment.findByPk(equipment.id, {
      include: [{
        model: db.Barcode,
        attributes: ['id', 'barcode']
      }]
    });

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Receiving Equipment: ' + error));
  }
};

exports.deleteEquipmentByID = async (req, res, next) => {
  try {
    const equipment = await db.Equipment.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!equipment) {
      return next(createError(404, 'Equipment not found'));
    }

    // Soft delete - set activeFlag to false
    await db.Equipment.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    // Also deactivate the associated barcode
    await db.Barcode.update(
      { activeFlag: false },
      { where: { id: equipment.barcodeID } }
    );

    res.json({ message: 'Equipment deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Equipment: ' + error));
  }
};
