const db = require('../../../models');
const createError = require('http-errors');

// Get all harnesses (paginated, with basic info)
exports.getAllHarnesses = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, includeInactive = false } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const { count, rows } = await db.WireHarness.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'partID', 'revision', 'description', 'thumbnailBase64', 'activeFlag', 'createdBy', 'createdAt', 'updatedAt'],
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform rows to include partNumber from Part
    const harnesses = rows.map(h => {
      const harness = h.toJSON();
      harness.partNumber = harness.Part ? harness.Part.name : null;
      return harness;
    });

    res.json({
      harnesses,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(createError(500, 'Error Getting Harnesses: ' + error.message));
  }
};

// Get single harness with full data
exports.getHarnessById = async (req, res, next) => {
  try {
    const harness = await db.WireHarness.findOne({
      where: {
        id: req.params.id
      },
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    // Add partNumber from Part
    const result = harness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Getting Harness: ' + error.message));
  }
};

// Get next available internal part number
exports.getNextPartNumber = async (req, res, next) => {
  try {
    // Find the highest part ID
    const maxPart = await db.Part.findOne({
      order: [['id', 'DESC']],
      attributes: ['id']
    });

    const nextId = (maxPart ? maxPart.id : 0) + 1;
    const partNumber = `LET-${String(nextId).padStart(4, '0')}`;

    res.json({ partNumber, nextId });
  } catch (error) {
    next(createError(500, 'Error getting next part number: ' + error.message));
  }
};

// Create new harness
exports.createHarness = async (req, res, next) => {
  try {
    const { name, revision, description, harnessData, thumbnailBase64, createPart, partID } = req.body;

    if (!name) {
      return next(createError(400, 'Name is required'));
    }

    let createdPart = null;
    let linkedPartId = partID || null;

    // If createPart is true, create an internal Part with category "Harness"
    if (createPart && !partID) {
      // Find the Harness category
      const harnessCategory = await db.PartCategory.findOne({
        where: { name: 'Harness', activeFlag: true }
      });

      if (!harnessCategory) {
        return next(createError(400, 'Harness category not found. Please create it first.'));
      }

      // Create the Part
      createdPart = await db.Part.create({
        name: name,
        description: description || null,
        internalPart: true,
        partCategoryID: harnessCategory.id,
        minimumOrderQuantity: 1,
        activeFlag: true,
        serialNumberRequired: false,
        lotNumberRequired: false
      });

      linkedPartId = createdPart.id;
    }

    const harness = await db.WireHarness.create({
      name,
      revision: revision || 'A',
      description: description || null,
      harnessData: harnessData || {},
      thumbnailBase64: thumbnailBase64 || null,
      createdBy: req.user ? req.user.displayName : null,
      partID: linkedPartId
    });

    // Return with computed partNumber from Part name
    const result = harness.toJSON();
    if (linkedPartId) {
      const linkedPart = createdPart || await db.Part.findByPk(linkedPartId);
      result.partNumber = linkedPart ? linkedPart.name : null;
    } else {
      result.partNumber = null;
    }

    res.status(201).json(result);
  } catch (error) {
    next(createError(500, 'Error Creating Harness: ' + error.message));
  }
};

// Update harness
exports.updateHarness = async (req, res, next) => {
  try {
    const { name, revision, description, harnessData, thumbnailBase64 } = req.body;

    const harness = await db.WireHarness.findOne({
      where: { id: req.params.id },
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (revision !== undefined) updateData.revision = revision;
    if (description !== undefined) updateData.description = description;
    if (harnessData !== undefined) updateData.harnessData = harnessData;
    if (thumbnailBase64 !== undefined) updateData.thumbnailBase64 = thumbnailBase64;

    await db.WireHarness.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedHarness = await db.WireHarness.findByPk(req.params.id, {
      include: [{
        model: db.Part,
        as: 'Part',
        attributes: ['id', 'name']
      }]
    });

    // Return with computed partNumber
    const result = updatedHarness.toJSON();
    result.partNumber = result.Part ? result.Part.name : null;

    res.json(result);
  } catch (error) {
    next(createError(500, 'Error Updating Harness: ' + error.message));
  }
};

// Soft delete harness
exports.deleteHarness = async (req, res, next) => {
  try {
    const harness = await db.WireHarness.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!harness) {
      return next(createError(404, 'Harness not found'));
    }

    await db.WireHarness.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Harness deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Harness: ' + error.message));
  }
};

// Validate JSON without saving
exports.validateHarness = async (req, res, next) => {
  try {
    const { harnessData } = req.body;

    if (!harnessData) {
      return res.json({
        valid: false,
        errors: ['No harness data provided']
      });
    }

    const errors = [];

    // Validate name (at top level, not under metadata)
    if (!harnessData.name) {
      errors.push('Missing name field');
    }

    // Validate connectors array
    if (!Array.isArray(harnessData.connectors)) {
      errors.push('Connectors must be an array');
    } else {
      harnessData.connectors.forEach((conn, idx) => {
        if (!conn.id) errors.push(`Connector at index ${idx} missing id`);
        if (!conn.label) errors.push(`Connector at index ${idx} missing label`);
      });
    }

    // Validate cables array
    if (!Array.isArray(harnessData.cables)) {
      errors.push('Cables must be an array');
    } else {
      harnessData.cables.forEach((cable, idx) => {
        if (!cable.id) errors.push(`Cable at index ${idx} missing id`);
        if (!cable.label) errors.push(`Cable at index ${idx} missing label`);
      });
    }

    // Validate connections array
    if (!Array.isArray(harnessData.connections)) {
      errors.push('Connections must be an array');
    } else {
      const connectorIds = new Set((harnessData.connectors || []).map(c => c.id));
      const cableIds = new Set((harnessData.cables || []).map(c => c.id));

      harnessData.connections.forEach((conn, idx) => {
        if (!conn.id) errors.push(`Connection at index ${idx} missing id`);

        // A connection must have a "from" endpoint (either connector or cable)
        const hasFromConnector = !!conn.fromConnector;
        const hasFromCable = !!conn.fromCable;
        if (!hasFromConnector && !hasFromCable) {
          errors.push(`Connection at index ${idx} missing fromConnector or fromCable`);
        }

        // A connection must have a "to" endpoint (either connector or cable)
        const hasToConnector = !!conn.toConnector;
        const hasToCable = !!conn.toCable;
        if (!hasToConnector && !hasToCable) {
          errors.push(`Connection at index ${idx} missing toConnector or toCable`);
        }

        // Validate referenced connectors exist
        if (conn.fromConnector && !connectorIds.has(conn.fromConnector)) {
          errors.push(`Connection at index ${idx} references non-existent fromConnector: ${conn.fromConnector}`);
        }
        if (conn.toConnector && !connectorIds.has(conn.toConnector)) {
          errors.push(`Connection at index ${idx} references non-existent toConnector: ${conn.toConnector}`);
        }

        // Validate referenced cables exist
        if (conn.fromCable && !cableIds.has(conn.fromCable)) {
          errors.push(`Connection at index ${idx} references non-existent fromCable: ${conn.fromCable}`);
        }
        if (conn.toCable && !cableIds.has(conn.toCable)) {
          errors.push(`Connection at index ${idx} references non-existent toCable: ${conn.toCable}`);
        }

        // Legacy: validate cable field if present
        if (conn.cable && !cableIds.has(conn.cable)) {
          errors.push(`Connection at index ${idx} references non-existent cable: ${conn.cable}`);
        }
      });
    }

    res.json({
      valid: errors.length === 0,
      errors
    });
  } catch (error) {
    next(createError(500, 'Error Validating Harness: ' + error.message));
  }
};
