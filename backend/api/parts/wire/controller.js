const db = require('../../../models');
const createError = require('http-errors');

// Get all wires
exports.getAllWires = async (req, res, next) => {
  try {
    const { includeInactive = false } = req.query;
    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const wires = await db.Wire.findAll({
      where: whereClause,
      order: [['label', 'ASC']],
      include: db.Part ? [{
        model: db.Part,
        as: 'part',
        attributes: ['id', 'name']
      }] : []
    });

    res.json(wires);
  } catch (error) {
    next(createError(500, 'Error Getting Wires: ' + error.message));
  }
};

// Get single wire
exports.getWireById = async (req, res, next) => {
  try {
    const wire = await db.Wire.findOne({
      where: { id: req.params.id },
      include: db.Part ? [{
        model: db.Part,
        as: 'part',
        attributes: ['id', 'name']
      }] : []
    });

    if (!wire) {
      return next(createError(404, 'Wire not found'));
    }

    res.json(wire);
  } catch (error) {
    next(createError(500, 'Error Getting Wire: ' + error.message));
  }
};

// Create wire
exports.createWire = async (req, res, next) => {
  try {
    const { label, color, colorCode, gaugeAWG, partID } = req.body;

    if (!label) {
      return next(createError(400, 'Label is required'));
    }
    if (!color) {
      return next(createError(400, 'Color is required'));
    }

    const wire = await db.Wire.create({
      label,
      color,
      colorCode: colorCode || null,
      gaugeAWG: gaugeAWG || null,
      partID: partID || null
    });

    res.status(201).json(wire);
  } catch (error) {
    next(createError(500, 'Error Creating Wire: ' + error.message));
  }
};

// Update wire
exports.updateWire = async (req, res, next) => {
  try {
    const { label, color, colorCode, gaugeAWG, partID } = req.body;

    const wire = await db.Wire.findOne({
      where: { id: req.params.id }
    });

    if (!wire) {
      return next(createError(404, 'Wire not found'));
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (color !== undefined) updateData.color = color;
    if (colorCode !== undefined) updateData.colorCode = colorCode;
    if (gaugeAWG !== undefined) updateData.gaugeAWG = gaugeAWG;
    if (partID !== undefined) updateData.partID = partID;

    await db.Wire.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedWire = await db.Wire.findByPk(req.params.id, {
      include: db.Part ? [{
        model: db.Part,
        as: 'part',
        attributes: ['id', 'name']
      }] : []
    });

    res.json(updatedWire);
  } catch (error) {
    next(createError(500, 'Error Updating Wire: ' + error.message));
  }
};

// Get wire by partID
exports.getWireByPartId = async (req, res, next) => {
  try {
    const wire = await db.Wire.findOne({
      where: { partID: req.params.partId, activeFlag: true },
      include: db.Part ? [{
        model: db.Part,
        as: 'part',
        attributes: ['id', 'name']
      }] : []
    });

    if (!wire) {
      return res.json(null);
    }

    res.json(wire);
  } catch (error) {
    next(createError(500, 'Error Getting Wire by Part ID: ' + error.message));
  }
};

// Soft delete wire
exports.deleteWire = async (req, res, next) => {
  try {
    const wire = await db.Wire.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!wire) {
      return next(createError(404, 'Wire not found'));
    }

    await db.Wire.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Wire deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Wire: ' + error.message));
  }
};
