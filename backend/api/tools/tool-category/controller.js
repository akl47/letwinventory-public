const db = require('../../../models');
const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

const subcategoryInclude = () => [{
  model: db.ToolSubcategory, as: 'subcategories',
  where: { activeFlag: true },
  required: false,
  through: { attributes: [] },
  attributes: ['id', 'name', 'description'],
}];

exports.list = async (req, res, next) => {
  try {
    const categories = await db.ToolCategory.findAll({
      where: { activeFlag: true },
      include: subcategoryInclude(),
      order: [['name', 'ASC']],
    });
    res.json(categories);
  } catch (error) {
    next(humanizeError(error, 'Failed to list tool categories'));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) return next(createError(400, 'Tool category name is required'));
    const cat = await db.ToolCategory.create({ name, description: description || '' });
    res.status(201).json(cat);
  } catch (error) {
    next(humanizeError(error, 'Failed to create tool category'));
  }
};

exports.update = async (req, res, next) => {
  try {
    const cat = await db.ToolCategory.findByPk(req.params.id);
    if (!cat) return next(createError(404, 'Tool category not found'));
    const { name, description } = req.body;
    await cat.update({
      name: name ?? cat.name,
      description: description ?? cat.description,
    });
    res.json(cat);
  } catch (error) {
    next(humanizeError(error, 'Failed to update tool category'));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const cat = await db.ToolCategory.findByPk(req.params.id);
    if (!cat) return next(createError(404, 'Tool category not found'));

    // Block delete if any active subcategory in this group is referenced by an active Tool
    const inUse = await db.Tool.count({
      where: { activeFlag: true },
      include: [{
        model: db.ToolSubcategory, as: 'toolSubcategory', required: true,
        include: [{ model: db.ToolCategory, as: 'categories', where: { id: cat.id }, required: true }],
      }],
    });
    if (inUse > 0) {
      return next(createError(400,
        `Cannot delete category "${cat.name}": ${inUse} active tool(s) reference subcategories under it.`));
    }

    await cat.update({ activeFlag: false });
    res.json({ message: 'Tool category removed' });
  } catch (error) {
    next(humanizeError(error, 'Failed to delete tool category'));
  }
};
