const db = require('../../../models');
const createError = require('http-errors');

// Enrich component pin groups with matingConnector from ElectricalPinType
async function enrichPinGroups(component) {
  if (!component || !component.pins || !component.pins.length) return component;
  const pinTypeIds = [...new Set(component.pins.map(g => g.pinTypeID).filter(Boolean))];
  if (!pinTypeIds.length) return component;
  const pinTypes = await db.ElectricalPinType.findAll({
    where: { id: pinTypeIds },
    attributes: ['id', 'matingConnector']
  });
  const ptMap = new Map(pinTypes.map(pt => [pt.id, pt.matingConnector]));
  component.pins = component.pins.map(g => ({
    ...g,
    matingConnector: g.pinTypeID ? (ptMap.get(g.pinTypeID) || false) : false
  }));
  return component;
}

// Get all components
exports.getAllComponents = async (req, res, next) => {
  try {
    const { includeInactive = false } = req.query;
    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const components = await db.ElectricalComponent.findAll({
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
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'componentImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    const enriched = await Promise.all(components.map(c => enrichPinGroups(c.toJSON())));
    res.json(enriched);
  } catch (error) {
    next(createError(500, 'Error Getting Components: ' + error.message));
  }
};

// Get single component
exports.getComponentById = async (req, res, next) => {
  try {
    const component = await db.ElectricalComponent.findOne({
      where: { id: req.params.id },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'componentImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!component) {
      return next(createError(404, 'Component not found'));
    }

    res.json(await enrichPinGroups(component.toJSON()));
  } catch (error) {
    next(createError(500, 'Error Getting Component: ' + error.message));
  }
};

// Create component
exports.createComponent = async (req, res, next) => {
  try {
    const { label, pinCount, pins, partID, pinoutDiagramFileID, componentImageFileID } = req.body;

    if (!label) {
      return next(createError(400, 'Label is required'));
    }

    // Use provided pins (pin groups) or create empty array
    // Pin groups structure: [{id, name, pinTypeID, pins: [{id, number, label}]}]
    let componentPins = pins || [];

    // Calculate total pin count from groups
    let totalPinCount = pinCount || 0;
    if (componentPins.length > 0) {
      totalPinCount = componentPins.reduce((total, group) => {
        return total + (group.pins ? group.pins.length : 0);
      }, 0);
    }

    const component = await db.ElectricalComponent.create({
      label,
      pinCount: totalPinCount,
      pins: componentPins,
      partID: partID || null,
      pinoutDiagramFileID: pinoutDiagramFileID || null,
      componentImageFileID: componentImageFileID || null
    });

    res.status(201).json(await enrichPinGroups(component.toJSON()));
  } catch (error) {
    next(createError(500, 'Error Creating Component: ' + error.message));
  }
};

// Update component
exports.updateComponent = async (req, res, next) => {
  try {
    const { label, pinCount, pins, partID, pinoutDiagramFileID, componentImageFileID } = req.body;

    const component = await db.ElectricalComponent.findOne({
      where: { id: req.params.id }
    });

    if (!component) {
      return next(createError(404, 'Component not found'));
    }

    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (pinCount !== undefined) updateData.pinCount = pinCount;
    if (pins !== undefined) updateData.pins = pins;
    if (partID !== undefined) updateData.partID = partID;
    if (pinoutDiagramFileID !== undefined) updateData.pinoutDiagramFileID = pinoutDiagramFileID;
    if (componentImageFileID !== undefined) updateData.componentImageFileID = componentImageFileID;

    await db.ElectricalComponent.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedComponent = await db.ElectricalComponent.findByPk(req.params.id, {
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'componentImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    res.json(await enrichPinGroups(updatedComponent.toJSON()));
  } catch (error) {
    next(createError(500, 'Error Updating Component: ' + error.message));
  }
};

// Get component by partID
exports.getComponentByPartId = async (req, res, next) => {
  try {
    const component = await db.ElectricalComponent.findOne({
      where: { partID: req.params.partId, activeFlag: true },
      include: [
        ...(db.Part ? [{
          model: db.Part,
          as: 'part',
          attributes: ['id', 'name']
        }] : []),
        ...(db.UploadedFile ? [{
          model: db.UploadedFile,
          as: 'pinoutDiagramFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }, {
          model: db.UploadedFile,
          as: 'componentImageFile',
          attributes: ['id', 'filename', 'mimeType', 'data']
        }] : [])
      ]
    });

    if (!component) {
      return res.json(null);
    }

    res.json(await enrichPinGroups(component.toJSON()));
  } catch (error) {
    next(createError(500, 'Error Getting Component by Part ID: ' + error.message));
  }
};

// Soft delete component
exports.deleteComponent = async (req, res, next) => {
  try {
    const component = await db.ElectricalComponent.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!component) {
      return next(createError(404, 'Component not found'));
    }

    await db.ElectricalComponent.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Component deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Component: ' + error.message));
  }
};
