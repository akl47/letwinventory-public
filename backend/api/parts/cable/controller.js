const db = require('../../../models');
const createError = require('http-errors');

// Get all cables
exports.getAllCables = async (req, res, next) => {
  try {
    const { includeInactive = false } = req.query;
    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const cables = await db.Cable.findAll({
      where: whereClause,
      order: [['label', 'ASC']],
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'cableDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    res.json(cables);
  } catch (error) {
    next(createError(500, 'Error Getting Cables: ' + error.message));
  }
};

// Get single cable
exports.getCableById = async (req, res, next) => {
  try {
    const cable = await db.Cable.findOne({
      where: { id: req.params.id },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'cableDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!cable) {
      return next(createError(404, 'Cable not found'));
    }

    res.json(cable);
  } catch (error) {
    next(createError(500, 'Error Getting Cable: ' + error.message));
  }
};

// Create cable
exports.createCable = async (req, res, next) => {
  try {
    const { label, wireCount, gaugeAWG, wires, partID, cableDiagramFileID } = req.body;

    if (!label) {
      return next(createError(400, 'Label is required'));
    }

    // Generate default wires if not provided
    let cableWires = wires;
    if (!wires || wires.length === 0) {
      cableWires = [];
      const count = wireCount || 1;
      for (let i = 0; i < count; i++) {
        cableWires.push({
          id: `wire-${i + 1}`,
          color: 'Black',
          colorCode: 'BK'
        });
      }
    }

    const cable = await db.Cable.create({
      label,
      wireCount: wireCount || cableWires.length,
      gaugeAWG: gaugeAWG || null,
      wires: cableWires,
      partID: partID || null,
      cableDiagramFileID: cableDiagramFileID || null
    });

    res.status(201).json(cable);
  } catch (error) {
    next(createError(500, 'Error Creating Cable: ' + error.message));
  }
};

// Update cable
exports.updateCable = async (req, res, next) => {
  try {
    const { label, wireCount, gaugeAWG, wires, partID, cableDiagramFileID } = req.body;

    const cable = await db.Cable.findOne({
      where: { id: req.params.id }
    });

    if (!cable) {
      return next(createError(404, 'Cable not found'));
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (wireCount !== undefined) updateData.wireCount = wireCount;
    if (gaugeAWG !== undefined) updateData.gaugeAWG = gaugeAWG;
    if (wires !== undefined) updateData.wires = wires;
    if (partID !== undefined) updateData.partID = partID;
    if (cableDiagramFileID !== undefined) updateData.cableDiagramFileID = cableDiagramFileID;

    await db.Cable.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedCable = await db.Cable.findByPk(req.params.id, {
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'cableDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    res.json(updatedCable);
  } catch (error) {
    next(createError(500, 'Error Updating Cable: ' + error.message));
  }
};

// Get cable by partID
exports.getCableByPartId = async (req, res, next) => {
  try {
    const cable = await db.Cable.findOne({
      where: { partID: req.params.partId, activeFlag: true },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'cableDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!cable) {
      return res.json(null);
    }

    res.json(cable);
  } catch (error) {
    next(createError(500, 'Error Getting Cable by Part ID: ' + error.message));
  }
};

// Soft delete cable
exports.deleteCable = async (req, res, next) => {
  try {
    const cable = await db.Cable.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!cable) {
      return next(createError(404, 'Cable not found'));
    }

    await db.Cable.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Cable deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Cable: ' + error.message));
  }
};
