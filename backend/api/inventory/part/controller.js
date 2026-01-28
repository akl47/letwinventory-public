const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');

exports.getAllPartCategories = (req, res, next) => {
  db.PartCategory.findAll({
    where: {
      activeFlag: true
    },
    order: [
      ['name', 'asc']
    ],
    attributes: ['id', 'name', 'tagColorHex']
  }).then(categories => {
    res.json(categories)
  }).catch(error => {
    next(createError(500, 'Error Getting Part Categories:' + error))
  })
}

exports.searchPartsByCategory = async (req, res, next) => {
  try {
    const { category, q } = req.query;

    if (!category) {
      return next(createError(400, 'Category parameter is required'));
    }

    // Find the category by name
    const partCategory = await db.PartCategory.findOne({
      where: { name: category, activeFlag: true }
    });

    if (!partCategory) {
      return res.json([]);
    }

    // Build search conditions
    const whereClause = {
      partCategoryID: partCategory.id,
      activeFlag: true
    };

    // Add search term if provided
    if (q && q.trim()) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { description: { [Op.iLike]: `%${q}%` } }
      ];
    }

    const parts = await db.Part.findAll({
      where: whereClause,
      order: [['name', 'ASC']],
      limit: 20,
      include: [{
        model: db.PartCategory,
        attributes: ['id', 'name', 'tagColorHex']
      }]
    });

    res.json(parts);
  } catch (error) {
    next(createError(500, 'Error searching parts: ' + error.message));
  }
};

exports.getAllParts = (req, res, next) => {
  // Return all parts (active and inactive), let frontend filter
  db.Part.findAll({
    order: [
      ['name', 'asc']
    ],
    include: [
      {
        model: db.Trace,
        where: {
          activeFlag: true
        },
        required: false
      },
      {
        model: db.PartCategory,
        attributes: ['id', 'name', 'tagColorHex']
      }
    ]
  }).then(parts => {
    res.json(parts)
  }).catch(error => {
    next(createError(500, 'Error Getting Parts:' + error))
  })
}


exports.createNewPart = (req, res, next) => {
  // Validate manufacturer fields for vendor parts
  if (!req.body.internalPart) {
    if (!req.body.manufacturer || !req.body.manufacturerPN) {
      return next(createError(400, 'Manufacturer and Manufacturer Part Number are required for vendor parts'));
    }
  }

  db.Part.create(req.body).then(part => {
    res.json(part)
  }).catch(error => {
    next(createError(500, 'Error Creating New Part:' + error))
  })
}

exports.updatePartByID = (req, res, next) => {
  // Validate manufacturer fields for vendor parts
  if (!req.body.internalPart) {
    if (!req.body.manufacturer || !req.body.manufacturerPN) {
      return next(createError(400, 'Manufacturer and Manufacturer Part Number are required for vendor parts'));
    }
  }

  db.Part.update(req.body, {
    where: {
      id: req.params.id
    },
    returning: true
  }).then(updated => {
    res.json(updated[1])
  }).catch(error => {
    next(createError(500, 'Error Updating Part:' + error))
  })
}

exports.deletePartByID = (req, res, next) => {
  db.Part.findOne({
    where: {
      id: req.params.id,
      activeFlag: true
    }
  }).then(part => {
    part = part.toJSON();
    part.activeFlag = false;
    db.Part.update(part, {
      where: {
        id: req.params.id,
        activeFlag: true
      }
    }).then(deletedPart => {
      res.json(deletedPart)
    }).catch(error => {
      next(createError(500, 'Error Updating Part:' + error))
    })
  }).catch(error => {
    next(createError(500, 'Error Getting Part:' + error))
  })
}

// exports.testError = (req, res, next) => {
//   next(new RestError('TEST ERROR PLEASE IGNORE', 500))
// }