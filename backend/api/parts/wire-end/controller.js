const db = require('../../../models');
const createError = require('http-errors');

// Get all wire ends
exports.getAllWireEnds = async (req, res, next) => {
  try {
    const { includeInactive = false } = req.query;
    const whereClause = includeInactive === 'true' ? {} : { activeFlag: true };

    const wireEnds = await db.WireEnd.findAll({
      where: whereClause,
      order: [['name', 'ASC']]
    });

    res.json(wireEnds);
  } catch (error) {
    next(createError(500, 'Error Getting Wire Ends: ' + error.message));
  }
};

// Get single wire end by id
exports.getWireEndById = async (req, res, next) => {
  try {
    const wireEnd = await db.WireEnd.findOne({
      where: { id: req.params.id }
    });

    if (!wireEnd) {
      return next(createError(404, 'Wire End not found'));
    }

    res.json(wireEnd);
  } catch (error) {
    next(createError(500, 'Error Getting Wire End: ' + error.message));
  }
};

// Get wire end by code
exports.getWireEndByCode = async (req, res, next) => {
  try {
    const wireEnd = await db.WireEnd.findOne({
      where: { code: req.params.code, activeFlag: true }
    });

    if (!wireEnd) {
      return res.json(null);
    }

    res.json(wireEnd);
  } catch (error) {
    next(createError(500, 'Error Getting Wire End by Code: ' + error.message));
  }
};

// Create wire end
exports.createWireEnd = async (req, res, next) => {
  try {
    const { code, name, description } = req.body;

    if (!code) {
      return next(createError(400, 'Code is required'));
    }
    if (!name) {
      return next(createError(400, 'Name is required'));
    }

    // Check for duplicate code
    const existing = await db.WireEnd.findOne({ where: { code } });
    if (existing) {
      return next(createError(400, 'Wire End with this code already exists'));
    }

    const wireEnd = await db.WireEnd.create({
      code,
      name,
      description: description || null
    });

    res.status(201).json(wireEnd);
  } catch (error) {
    next(createError(500, 'Error Creating Wire End: ' + error.message));
  }
};

// Update wire end
exports.updateWireEnd = async (req, res, next) => {
  try {
    const { code, name, description } = req.body;

    const wireEnd = await db.WireEnd.findOne({
      where: { id: req.params.id }
    });

    if (!wireEnd) {
      return next(createError(404, 'Wire End not found'));
    }

    const updateData = {};
    if (code !== undefined) updateData.code = code;
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    await db.WireEnd.update(updateData, {
      where: { id: req.params.id }
    });

    const updatedWireEnd = await db.WireEnd.findByPk(req.params.id);

    res.json(updatedWireEnd);
  } catch (error) {
    next(createError(500, 'Error Updating Wire End: ' + error.message));
  }
};

// Soft delete wire end
exports.deleteWireEnd = async (req, res, next) => {
  try {
    const wireEnd = await db.WireEnd.findOne({
      where: {
        id: req.params.id,
        activeFlag: true
      }
    });

    if (!wireEnd) {
      return next(createError(404, 'Wire End not found'));
    }

    await db.WireEnd.update(
      { activeFlag: false },
      { where: { id: req.params.id } }
    );

    res.json({ message: 'Wire End deleted successfully' });
  } catch (error) {
    next(createError(500, 'Error Deleting Wire End: ' + error.message));
  }
};
