const db = require('../../../models');
const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

const categoryInclude = () => [{
  model: db.ToolCategory, as: 'categories',
  where: { activeFlag: true },
  required: false,
  through: { attributes: [] },
  attributes: ['id', 'name'],
}];

async function setSubcategoryCategories(subcategory, categoryIDs) {
  if (!Array.isArray(categoryIDs)) return;
  // Validate every id refers to an active category
  const cats = await db.ToolCategory.findAll({
    where: { id: categoryIDs, activeFlag: true },
  });
  if (cats.length !== categoryIDs.length) {
    throw createError(400, 'One or more category IDs are invalid or inactive');
  }
  await subcategory.setCategories(cats);
}

exports.list = async (req, res, next) => {
  try {
    const where = { activeFlag: true };
    if (req.query.categoryID) {
      const cat = await db.ToolCategory.findByPk(req.query.categoryID, {
        include: [{
          model: db.ToolSubcategory, as: 'subcategories',
          where: { activeFlag: true },
          required: false,
          through: { attributes: [] },
          include: categoryInclude(),
        }],
      });
      return res.json(cat?.subcategories ?? []);
    }
    const subs = await db.ToolSubcategory.findAll({
      where,
      include: categoryInclude(),
      order: [['name', 'ASC']],
    });
    res.json(subs);
  } catch (error) {
    next(humanizeError(error, 'Failed to list tool subcategories'));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, description, categoryIDs } = req.body;
    if (!name) return next(createError(400, 'Tool subcategory name is required'));
    if (!Array.isArray(categoryIDs) || categoryIDs.length === 0) {
      return next(createError(400, 'At least one category must be selected'));
    }
    const sub = await db.ToolSubcategory.create({ name, description: description || '' });
    await setSubcategoryCategories(sub, categoryIDs);
    const result = await db.ToolSubcategory.findByPk(sub.id, { include: categoryInclude() });
    res.status(201).json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(humanizeError(error, 'Failed to create tool subcategory'));
  }
};

exports.update = async (req, res, next) => {
  try {
    const sub = await db.ToolSubcategory.findByPk(req.params.id);
    if (!sub) return next(createError(404, 'Tool subcategory not found'));
    const { name, description, categoryIDs } = req.body;
    await sub.update({
      name: name ?? sub.name,
      description: description ?? sub.description,
    });
    if (categoryIDs !== undefined) {
      await setSubcategoryCategories(sub, categoryIDs);
    }
    const result = await db.ToolSubcategory.findByPk(sub.id, { include: categoryInclude() });
    res.json(result);
  } catch (error) {
    if (error.status) return next(error);
    next(humanizeError(error, 'Failed to update tool subcategory'));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const sub = await db.ToolSubcategory.findByPk(req.params.id);
    if (!sub) return next(createError(404, 'Tool subcategory not found'));

    const inUse = await db.Tool.count({
      where: { toolSubcategoryID: sub.id, activeFlag: true },
    });
    if (inUse > 0) {
      return next(createError(400,
        `Cannot delete subcategory "${sub.name}": ${inUse} active tool(s) reference it.`));
    }

    await sub.update({ activeFlag: false });
    res.json({ message: 'Tool subcategory removed' });
  } catch (error) {
    next(humanizeError(error, 'Failed to delete tool subcategory'));
  }
};
