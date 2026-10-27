const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');
const { buildTagChain } = require('../barcode/controller');
const humanizeError = require('../../../util/humanizeError');

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
    next(humanizeError(error, 'Failed to get part categories'))
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

    // Build includes - always include Part's own imageFile
    const includes = [
      {
        model: db.PartCategory,
        attributes: ['id', 'name', 'tagColorHex']
      },
      {
        model: db.UploadedFile,
        as: 'imageFile',
        attributes: ['id', 'filename', 'mimeType']
      }
    ];

    // Include the electrical model with its image based on category
    const categoryLower = category.toLowerCase();
    if (categoryLower === 'connector') {
      includes.push({
        model: db.ElectricalConnector,
        as: 'electricalConnector',
        required: false,
        attributes: ['id'],
        include: [{
          model: db.UploadedFile,
          as: 'connectorImageFile',
          attributes: ['id', 'filename', 'mimeType']
        }]
      });
    } else if (categoryLower === 'cable') {
      includes.push({
        model: db.Cable,
        as: 'cable',
        required: false,
        attributes: ['id'],
        include: [{
          model: db.UploadedFile,
          as: 'cableDiagramFile',
          attributes: ['id', 'filename', 'mimeType']
        }]
      });
    } else if (categoryLower === 'electrical component') {
      includes.push({
        model: db.ElectricalComponent,
        as: 'electricalComponent',
        required: false,
        attributes: ['id'],
        include: [{
          model: db.UploadedFile,
          as: 'componentImageFile',
          attributes: ['id', 'filename', 'mimeType']
        }]
      });
    }

    const parts = await db.Part.findAll({
      where: whereClause,
      order: [['name', 'ASC']],
      limit: 20,
      include: includes
    });

    // Post-process: if Part has no imageFile, use the electrical part's image
    const result = parts.map(p => {
      const json = p.toJSON();
      if (!json.imageFile) {
        if (json.electricalConnector?.connectorImageFile) {
          json.imageFile = json.electricalConnector.connectorImageFile;
        } else if (json.cable?.cableDiagramFile) {
          json.imageFile = json.cable.cableDiagramFile;
        } else if (json.electricalComponent?.componentImageFile) {
          json.imageFile = json.electricalComponent.componentImageFile;
        }
      }
      // Remove nested electrical data from response
      delete json.electricalConnector;
      delete json.cable;
      delete json.electricalComponent;
      return json;
    });

    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to search parts'));
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
      },
      {
        model: db.UploadedFile,
        as: 'imageFile',
        attributes: ['id', 'filename', 'mimeType']
      },
      {
        model: db.UnitOfMeasure,
        as: 'UnitOfMeasure',
        attributes: ['id', 'name', 'allowDecimal']
      }
    ]
  }).then(parts => {
    res.json(parts)
  }).catch(error => {
    next(humanizeError(error, 'Failed to get parts'))
  })
}

exports.getPartByID = (req, res, next) => {
  db.Part.findOne({
    where: {
      id: req.params.id
    },
    include: [
      {
        model: db.PartCategory,
        attributes: ['id', 'name', 'tagColorHex']
      },
      {
        model: db.UploadedFile,
        as: 'imageFile',
        attributes: ['id', 'filename', 'mimeType']
      }
    ]
  }).then(part => {
    if (!part) {
      return next(createError(404, 'Part not found'));
    }
    res.json(part)
  }).catch(error => {
    next(humanizeError(error, 'Failed to get part'))
  })
}


exports.createNewPart = async (req, res, next) => {
  try {
    // Validate manufacturer fields for vendor parts
    if (!req.body.internalPart) {
      if (!req.body.manufacturer || !req.body.manufacturerPN) {
        return next(createError(400, 'Manufacturer and Manufacturer Part Number are required for vendor parts'));
      }
    }

    // Set default revision if not provided
    if (!req.body.revision) {
      req.body.revision = req.body.internalPart ? '01' : '00';
    }

    const part = await db.Part.create(req.body);

    await db.PartRevisionHistory.create({
      partID: part.id,
      changedByUserID: req.user?.id || null,
      changeType: 'created',
      changes: null,
      createdAt: new Date()
    });

    res.json(part);
  } catch (error) {
    next(humanizeError(error, 'Failed to create part'));
  }
}

exports.updatePartByID = async (req, res, next) => {
  try {
    const part = await db.Part.findByPk(req.params.id);
    if (!part) return next(createError(404, 'Part not found'));
    if (part.revisionLocked) return next(createError(403, 'This revision is locked and cannot be edited'));

    // Validate manufacturer fields for vendor parts
    if (!req.body.internalPart) {
      if (!req.body.manufacturer || !req.body.manufacturerPN) {
        return next(createError(400, 'Manufacturer and Manufacturer Part Number are required for vendor parts'));
      }
    }

    const updated = await db.Part.update(req.body, {
      where: { id: req.params.id },
      returning: true
    });

    // Compute field-level diffs and record history
    const changes = {};
    const fields = ['name', 'description', 'vendor', 'sku', 'link', 'minimumOrderQuantity', 'partCategoryID',
      'serialNumberRequired', 'lotNumberRequired', 'defaultUnitOfMeasureID', 'manufacturer', 'manufacturerPN',
      'minimumStockQuantity', 'imageFileID', 'internalPart'];
    for (const field of fields) {
      if (req.body[field] !== undefined && req.body[field] !== part[field]) {
        changes[field] = { old: part[field], new: req.body[field] };
      }
    }
    if (Object.keys(changes).length > 0) {
      await db.PartRevisionHistory.create({
        partID: part.id,
        changedByUserID: req.user?.id || null,
        changeType: 'updated',
        changes,
        createdAt: new Date()
      });
    }

    res.json(updated[1]);
  } catch (error) {
    next(humanizeError(error, 'Failed to update part'));
  }
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
      next(humanizeError(error, 'Failed to update part'))
    })
  }).catch(error => {
    next(humanizeError(error, 'Failed to get part'))
  })
}

exports.getStockLevels = async (req, res, next) => {
  try {
    const stockLevels = await db.Trace.findAll({
      where: { activeFlag: true },
      attributes: [
        'partID',
        [db.sequelize.fn('SUM', db.sequelize.col('quantity')), 'totalQuantity']
      ],
      group: ['partID']
    });
    const result = {};
    stockLevels.forEach(row => {
      const json = row.toJSON();
      result[json.partID] = parseInt(json.totalQuantity, 10);
    });
    res.json(result);
  } catch (error) {
    next(humanizeError(error, 'Failed to get stock levels'));
  }
};

exports.getPartLocations = async (req, res, next) => {
  try {
    const partID = req.params.id;

    const traces = await db.Trace.findAll({
      where: { partID, activeFlag: true },
      include: [
        {
          model: db.UnitOfMeasure,
          as: 'unitOfMeasure',
          attributes: ['id', 'name']
        },
        {
          model: db.Barcode,
          attributes: ['id', 'barcode']
        }
      ]
    });

    let totalQuantity = 0;
    const traceResults = [];

    for (const trace of traces) {
      const json = trace.toJSON();
      totalQuantity += json.quantity;

      let locationPath = '';
      try {
        const chain = await buildTagChain(json.barcodeID);
        // Chain goes from trace -> parent -> grandparent...
        // Skip the first entry (the trace itself), reverse for top-down path
        const locationParts = chain.slice(1).reverse();
        locationPath = locationParts.map(t => t.name).join(' > ');
      } catch (e) {
        locationPath = 'Unknown';
      }

      traceResults.push({
        id: json.id,
        quantity: json.quantity,
        serialNumber: json.serialNumber,
        lotNumber: json.lotNumber,
        unitOfMeasure: json.unitOfMeasure?.name || null,
        barcodeID: json.barcodeID,
        barcode: json.Barcode?.barcode || null,
        locationPath
      });
    }

    // Fetch pending order items for this part (not fully received)
    const pendingOrderItems = await db.OrderItem.findAll({
      where: {
        partID,
        activeFlag: true
      },
      include: [
        {
          model: db.Order,
          where: { activeFlag: true },
          attributes: ['id', 'vendor', 'orderStatusID'],
          include: [{
            model: db.OrderStatus,
            attributes: ['id', 'name']
          }]
        }
      ]
    });

    const pendingOrders = pendingOrderItems
      .filter(item => {
        const json = item.toJSON();
        const remaining = json.quantity - (json.receivedQuantity || 0);
        return remaining > 0 && json.Order.orderStatusID !== 4; // 4 = Received
      })
      .map(item => {
        const json = item.toJSON();
        return {
          orderItemId: json.id,
          orderId: json.Order.id,
          vendor: json.Order.vendor,
          status: json.Order.OrderStatus?.name || 'Unknown',
          quantityOrdered: json.quantity,
          quantityReceived: json.receivedQuantity || 0,
          quantityPending: json.quantity - (json.receivedQuantity || 0)
        };
      });

    res.json({ traces: traceResults, totalQuantity, pendingOrders });
  } catch (error) {
    next(humanizeError(error, 'Failed to get part locations'));
  }
};

// Revision numbering + revision-row creation live in partRevisionService so the
// CAD release workflow can reuse them inside its own transaction.
const partRevisionService = require('../../../services/partRevisionService');

exports.createNewRevision = async (req, res, next) => {
  let partName = '?';
  try {
    const part = await db.Part.findByPk(req.params.id);
    if (!part) return next(createError(404, 'Part not found'));
    partName = part.name;
    const newPart = await partRevisionService.createNewRevision(part, req.user?.id, {});
    res.json(newPart);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createError(409, `Part "${partName}" revision conflict. Existing revisions may need to be cleaned up.`));
    }
    if (error.name === 'SequelizeValidationError') {
      const details = error.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      return next(createError(400, `Validation failed: ${details}`));
    }
    next(humanizeError(error, 'Failed to create new revision'));
  }
};

exports.releaseToProduction = async (req, res, next) => {
  let partName = '?';
  try {
    const part = await db.Part.findByPk(req.params.id);
    if (!part) return next(createError(404, 'Part not found'));
    partName = part.name;
    const newPart = await partRevisionService.releaseToProduction(part, req.user?.id, {});
    res.json(newPart);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createError(409, `Part "${partName}" revision conflict. Existing revisions may need to be cleaned up.`));
    }
    if (error.name === 'SequelizeValidationError') {
      const details = error.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      return next(createError(400, `Validation failed: ${details}`));
    }
    next(humanizeError(error, 'Failed to release to production'));
  }
};

exports.lockRevision = async (req, res, next) => {
  try {
    const part = await db.Part.findByPk(req.params.id);
    if (!part) return next(createError(404, 'Part not found'));
    await part.update({ revisionLocked: true });
    await db.PartRevisionHistory.create({
      partID: part.id,
      changedByUserID: req.user?.id || null,
      changeType: 'locked',
      changes: null,
      createdAt: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    next(humanizeError(error, 'Failed to lock revision'));
  }
};

exports.unlockRevision = async (req, res, next) => {
  try {
    const part = await db.Part.findByPk(req.params.id);
    if (!part) return next(createError(404, 'Part not found'));
    await part.update({ revisionLocked: false });
    await db.PartRevisionHistory.create({
      partID: part.id,
      changedByUserID: req.user?.id || null,
      changeType: 'unlocked',
      changes: null,
      createdAt: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    next(humanizeError(error, 'Failed to unlock revision'));
  }
};

exports.getRevisionHistory = async (req, res, next) => {
  try {
    const history = await db.PartRevisionHistory.findAll({
      where: { partID: req.params.id },
      include: [{ model: db.User, as: 'changedBy', attributes: ['id', 'displayName'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(history);
  } catch (error) {
    next(humanizeError(error, 'Failed to get revision history'));
  }
};

exports.getRevisionsByName = async (req, res, next) => {
  try {
    const parts = await db.Part.findAll({
      where: { name: req.params.name },
      include: [{ model: db.PartCategory }, { model: db.UploadedFile, as: 'imageFile', attributes: ['id', 'filename', 'mimeType'] }],
      order: [['createdAt', 'ASC']]
    });
    res.json(parts);
  } catch (error) {
    next(humanizeError(error, 'Failed to get revisions'));
  }
};

// exports.testError = (req, res, next) => {
//   next(new RestError('TEST ERROR PLEASE IGNORE', 500))
// }