const db = require('../../../models');
const createError = require('http-errors');

// Get all connectors
exports.getAllConnectors = async (req, res, next) => {
  try {
    const { includeInactive = false } = req.query;
    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const connectors = await db.ElectricalConnector.findAll({
      where: whereClause,
      order: [['label', 'ASC']],
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.ElectricalPinType ? [{
          model: db.ElectricalPinType,
          as: 'pinType',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'connectorImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    res.json(connectors);
  } catch (error) {
    next(createError(500, 'Error Getting Connectors: ' + error.message));
  }
};

// Get single connector
exports.getConnectorById = async (req, res, next) => {
  try {
    const connector = await db.ElectricalConnector.findOne({
      where: { id: req.params.id },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.ElectricalPinType ? [{
          model: db.ElectricalPinType,
          as: 'pinType',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'connectorImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!connector) {
      return next(createError(404, 'Connector not found'));
    }

    res.json(connector);
  } catch (error) {
    next(createError(500, 'Error Getting Connector: ' + error.message));
  }
};

// Create connector
exports.createConnector = async (req, res, next) => {
  try {
    const { label, type, pinCount, color, pins, partID, pinoutDiagramFileID, connectorImageFileID, electricalPinTypeID } = req.body;

    if (!label) {
      return next(createError(400, 'Label is required'));
    }
    if (!type) {
      return next(createError(400, 'Type is required'));
    }

    // Generate default pins if not provided
    let connectorPins = pins;
    if (!pins || pins.length === 0) {
      connectorPins = [];
      const count = pinCount || 1;
      for (let i = 0; i < count; i++) {
        connectorPins.push({
          id: `pin-${i + 1}`,
          number: String(i + 1),
          label: ''
        });
      }
    }

    const connector = await db.ElectricalConnector.create({
      label,
      type,
      pinCount: pinCount || connectorPins.length,
      color: color || null,
      pins: connectorPins,
      partID: partID || null,
      pinoutDiagramFileID: pinoutDiagramFileID || null,
      connectorImageFileID: connectorImageFileID || null,
      electricalPinTypeID: electricalPinTypeID || null
    });

    res.status(201).json(connector);
  } catch (error) {
    next(createError(500, 'Error Creating Connector: ' + error.message));
  }
};

// Update connector
exports.updateConnector = async (req, res, next) => {
  try {
    const { label, type, pinCount, color, pins, partID, pinoutDiagramFileID, connectorImageFileID, electricalPinTypeID } = req.body;

    const connector = await db.ElectricalConnector.findOne({
      where: { id: req.params.id }
    });

    if (!connector) {
      return next(createError(404, 'Connector not found'));
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (type !== undefined) updateData.type = type;
    if (pinCount !== undefined) updateData.pinCount = pinCount;
    if (color !== undefined) updateData.color = color;
    if (pins !== undefined) updateData.pins = pins;
    if (partID !== undefined) updateData.partID = partID;
    if (pinoutDiagramFileID !== undefined) updateData.pinoutDiagramFileID = pinoutDiagramFileID;
    if (connectorImageFileID !== undefined) updateData.connectorImageFileID = connectorImageFileID;
    if (electricalPinTypeID !== undefined) updateData.electricalPinTypeID = electricalPinTypeID;

    await db.ElectricalConnector.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedConnector = await db.ElectricalConnector.findByPk(req.params.id, {
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.ElectricalPinType ? [{
          model: db.ElectricalPinType,
          as: 'pinType',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'connectorImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    res.json(updatedConnector);
  } catch (error) {
    next(createError(500, 'Error Updating Connector: ' + error.message));
  }
};

// Get connector by partID
exports.getConnectorByPartId = async (req, res, next) => {
  try {
    const connector = await db.ElectricalConnector.findOne({
      where: { partID: req.params.partId, activeFlag: true },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.ElectricalPinType ? [{
          model: db.ElectricalPinType,
          as: 'pinType',
          attributes: ['id', 'name', 'matingConnector']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'connectorImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!connector) {
      return res.json(null);
    }

    res.json(connector);
  } catch (error) {
    next(createError(500, 'Error Getting Connector by Part ID: ' + error.message));
  }
};

// Get all electrical pin types
exports.getAllPinTypes = async (req, res, next) => {
  try {
    const pinTypes = await db.ElectricalPinType.findAll({
      where: { activeFlag: true },
      order: [['name', 'ASC']],
      attributes: ['id', 'name', 'description', 'matingConnector']
    });

    res.json(pinTypes);
  } catch (error) {
    next(createError(500, 'Error Getting Pin Types: ' + error.message));
  }
};

// Soft delete connector
exports.deleteConnector = async (req, res, next) => {
  try {
    const connector = await db.ElectricalConnector.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!connector) {
      return next(createError(404, 'Connector not found'));
    }

    await db.ElectricalConnector.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Connector deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Connector: ' + error.message));
  }
};
