const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');
const humanizeError = require('../../../util/humanizeError');

const toolIncludes = () => [
  { model: db.Part, as: 'part',
    attributes: ['id', 'name', 'description', 'revision', 'imageFileID'] },
  { model: db.ToolSubcategory, as: 'toolSubcategory',
    attributes: ['id', 'name'],
    include: [{
      model: db.ToolCategory, as: 'categories',
      where: { activeFlag: true }, required: false,
      through: { attributes: [] },
      attributes: ['id', 'name'],
    }],
  },
];

const WRITABLE_FIELDS = [
  'toolSubcategoryID', 'diameter', 'overallLength', 'fluteLength', 'shankDiameter',
  'cornerRadius', 'reducedShankDiameter', 'squareDriveSize', 'numberOfSteps', 'stepDelta',
  'numberOfFlutes', 'tipAngle', 'toolMaterial', 'coating', 'notes', 'activeFlag',
];

function pickWritable(body) {
  const out = {};
  for (const f of WRITABLE_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

exports.list = async (req, res, next) => {
  try {
    const where = {};
    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    if (!includeInactive) where.activeFlag = true;
    if (req.query.subcategoryID) where.toolSubcategoryID = parseInt(req.query.subcategoryID);

    const include = toolIncludes();
    if (req.query.q) {
      const q = req.query.q;
      include[0].where = {
        [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { description: { [Op.like]: `%${q}%` } },
        ],
      };
      include[0].required = true;
    }
    if (req.query.categoryID) {
      include[1].include[0].where = {
        ...include[1].include[0].where,
        id: parseInt(req.query.categoryID),
      };
      include[1].include[0].required = true;
      include[1].required = true;
    }

    const tools = await db.Tool.findAll({
      where,
      include,
      order: [[{ model: db.ToolSubcategory, as: 'toolSubcategory' }, 'name', 'ASC']],
    });
    res.json(tools);
  } catch (error) {
    next(humanizeError(error, 'Failed to list tools'));
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tool = await db.Tool.findByPk(req.params.id, { include: toolIncludes() });
    if (!tool) return next(createError(404, 'Tool not found'));
    res.json(tool);
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch tool'));
  }
};

exports.getByPart = async (req, res, next) => {
  try {
    const tool = await db.Tool.findOne({
      where: { partID: req.params.partID },
      include: toolIncludes(),
    });
    if (!tool) return next(createError(404, 'Tool not found for this part'));
    res.json(tool);
  } catch (error) {
    next(humanizeError(error, 'Failed to fetch tool by part'));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { partID, toolSubcategoryID } = req.body;
    if (!partID) return next(createError(400, 'partID is required'));
    if (!toolSubcategoryID) return next(createError(400, 'toolSubcategoryID is required'));

    const existing = await db.Tool.findOne({ where: { partID } });
    if (existing) {
      return next(createError(409, `A tool record already exists for this part`));
    }

    const part = await db.Part.findByPk(partID);
    if (!part) return next(createError(400, 'Part not found'));

    const sub = await db.ToolSubcategory.findByPk(toolSubcategoryID);
    if (!sub || !sub.activeFlag) {
      return next(createError(400, 'Tool subcategory not found or inactive'));
    }

    const tool = await db.Tool.create({
      partID,
      ...pickWritable(req.body),
    });
    const result = await db.Tool.findByPk(tool.id, { include: toolIncludes() });
    res.status(201).json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to create tool'));
  }
};

exports.update = async (req, res, next) => {
  try {
    const tool = await db.Tool.findByPk(req.params.id);
    if (!tool) return next(createError(404, 'Tool not found'));

    if (req.body.toolSubcategoryID !== undefined && req.body.toolSubcategoryID !== null) {
      const sub = await db.ToolSubcategory.findByPk(req.body.toolSubcategoryID);
      if (!sub || !sub.activeFlag) {
        return next(createError(400, 'Tool subcategory not found or inactive'));
      }
    }

    // partID is immutable post-create — silently ignored if present in body.
    await tool.update(pickWritable(req.body));
    const result = await db.Tool.findByPk(tool.id, { include: toolIncludes() });
    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to update tool'));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tool = await db.Tool.findByPk(req.params.id);
    if (!tool) return next(createError(404, 'Tool not found'));
    await tool.update({ activeFlag: false });
    res.json({ message: 'Tool removed' });
  } catch (error) {
    next(humanizeError(error, 'Failed to delete tool'));
  }
};
