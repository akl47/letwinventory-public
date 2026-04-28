const db = require('../../../models');
const createError = require('http-errors');
const { Op } = require('sequelize');
const { buildTagChain } = require('../barcode/controller');

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
    next(createError(500, 'Error Getting Parts:' + error))
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
    next(createError(500, 'Error Getting Part:' + error))
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
    next(createError(500, 'Error Creating New Part:' + error));
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
    next(createError(500, 'Error Updating Part:' + error));
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
      next(createError(500, 'Error Updating Part:' + error))
    })
  }).catch(error => {
    next(createError(500, 'Error Getting Part:' + error))
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
    next(createError(500, 'Error getting stock levels: ' + error.message));
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
    next(createError(500, 'Error getting part locations: ' + error.message));
  }
};

// Production revision letters: A-Y excluding I, O, Q, S, X, Z
// Sequence: A B C D E F G H J K L M N P R T U V W Y
// After Y: AA AB AC ... AY, then BA BB ... BY, etc.
const REV_LETTERS = 'ABCDEFGHJKLMNPRTUVWY'.split('');

function letterRevToIndex(rev) {
  const chars = rev.toUpperCase().split('');
  let index = 0;
  for (const ch of chars) {
    const pos = REV_LETTERS.indexOf(ch);
    if (pos === -1) return -1;
    index = index * REV_LETTERS.length + pos;
  }
  // Offset for length: single-letter = 0..19, double-letter starts at 20
  for (let len = 1; len < chars.length; len++) {
    index += Math.pow(REV_LETTERS.length, len);
  }
  return index;
}

function indexToLetterRev(index) {
  // Determine how many characters needed
  let len = 1;
  let capacity = REV_LETTERS.length; // 20 single letters
  while (index >= capacity) {
    index -= capacity;
    len++;
    capacity = Math.pow(REV_LETTERS.length, len);
  }
  let result = '';
  for (let i = len - 1; i >= 0; i--) {
    const divisor = Math.pow(REV_LETTERS.length, i);
    const digit = Math.floor(index / divisor);
    result += REV_LETTERS[digit];
    index %= divisor;
  }
  return result;
}

function getNextLetterRevision(current) {
  if (!current) return REV_LETTERS[0];
  const idx = letterRevToIndex(current);
  if (idx === -1) return REV_LETTERS[0];
  return indexToLetterRev(idx + 1);
}

exports.createNewRevision = async (req, res, next) => {
  let partName = '?';
  let nextRev = '?';
  try {
    const part = await db.Part.findByPk(req.params.id, {
      include: [{ model: db.BillOfMaterialItem, as: 'bomItems', where: { activeFlag: true }, required: false }]
    });
    if (!part) return next(createError(404, 'Part not found'));
    partName = part.name;

    // Find the latest numeric revision for this part name
    const allRevisions = await db.Part.findAll({
      where: { name: part.name },
      attributes: ['id', 'revision']
    });
    const existingRevisions = new Set(allRevisions.map(p => p.revision));
    const numericRevisions = [...existingRevisions].filter(r => /^\d+$/.test(r));
    let nextNum = 1;
    if (numericRevisions.length > 0) {
      nextNum = Math.max(...numericRevisions.map(r => parseInt(r, 10))) + 1;
    }
    nextRev = nextNum.toString().padStart(2, '0');
    while (existingRevisions.has(nextRev)) {
      nextNum++;
      nextRev = nextNum.toString().padStart(2, '0');
    }
    const partData = part.toJSON();
    const newPart = await db.Part.create({
      name: partData.name,
      description: partData.description,
      internalPart: partData.internalPart,
      vendor: partData.vendor,
      sku: partData.sku,
      link: partData.link,
      minimumOrderQuantity: partData.minimumOrderQuantity,
      partCategoryID: partData.partCategoryID,
      serialNumberRequired: partData.serialNumberRequired,
      lotNumberRequired: partData.lotNumberRequired,
      defaultUnitOfMeasureID: partData.defaultUnitOfMeasureID,
      manufacturer: partData.manufacturer,
      manufacturerPN: partData.manufacturerPN,
      minimumStockQuantity: partData.minimumStockQuantity,
      imageFileID: partData.imageFileID,
      activeFlag: true,
      revision: nextRev,
      revisionLocked: false,
      previousRevisionID: part.id,
    });

    // Copy BOM items
    if (partData.bomItems?.length > 0) {
      await db.BillOfMaterialItem.bulkCreate(
        partData.bomItems.map(item => ({
          partID: newPart.id,
          componentPartID: item.componentPartID,
          quantity: item.quantity,
          activeFlag: true,
        }))
      );
    }

    // Record history
    await db.PartRevisionHistory.create({
      partID: newPart.id,
      changedByUserID: req.user?.id || null,
      changeType: 'new_revision',
      changes: { previousRevision: { old: null, new: part.revision }, previousPartID: { old: null, new: part.id } },
      createdAt: new Date()
    });

    res.json(newPart);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createError(409, `Part "${partName}" already has revision "${nextRev}". Existing revisions may need to be cleaned up.`));
    }
    if (error.name === 'SequelizeValidationError') {
      const details = error.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      return next(createError(400, `Validation failed: ${details}`));
    }
    next(createError(500, 'Error creating new revision: ' + error.message));
  }
};

exports.releaseToProduction = async (req, res, next) => {
  let partName = '?';
  let nextRev = '?';
  try {
    const part = await db.Part.findByPk(req.params.id, {
      include: [{ model: db.BillOfMaterialItem, as: 'bomItems', where: { activeFlag: true }, required: false }]
    });
    if (!part) return next(createError(404, 'Part not found'));
    partName = part.name;

    // Find the latest letter revision for this part name
    const allRevisions = await db.Part.findAll({
      where: { name: part.name },
      attributes: ['revision']
    });
    const existingRevisions = new Set(allRevisions.map(p => p.revision));
    const letterRevisions = allRevisions.map(p => p.revision).filter(r => /^[A-Z]+$/.test(r));
    nextRev = REV_LETTERS[0];
    if (letterRevisions.length > 0) {
      const sorted = letterRevisions.sort((a, b) => letterRevToIndex(a) - letterRevToIndex(b));
      nextRev = getNextLetterRevision(sorted[sorted.length - 1]);
    }
    while (existingRevisions.has(nextRev)) {
      nextRev = getNextLetterRevision(nextRev);
    }

    const partData = part.toJSON();
    const newPart = await db.Part.create({
      name: partData.name,
      description: partData.description,
      internalPart: partData.internalPart,
      vendor: partData.vendor,
      sku: partData.sku,
      link: partData.link,
      minimumOrderQuantity: partData.minimumOrderQuantity,
      partCategoryID: partData.partCategoryID,
      serialNumberRequired: partData.serialNumberRequired,
      lotNumberRequired: partData.lotNumberRequired,
      defaultUnitOfMeasureID: partData.defaultUnitOfMeasureID,
      manufacturer: partData.manufacturer,
      manufacturerPN: partData.manufacturerPN,
      minimumStockQuantity: partData.minimumStockQuantity,
      imageFileID: partData.imageFileID,
      activeFlag: true,
      revision: nextRev,
      revisionLocked: false,
      previousRevisionID: part.id,
    });

    // Copy BOM items
    if (partData.bomItems?.length > 0) {
      await db.BillOfMaterialItem.bulkCreate(
        partData.bomItems.map(item => ({
          partID: newPart.id,
          componentPartID: item.componentPartID,
          quantity: item.quantity,
          activeFlag: true,
        }))
      );
    }

    // Lock the source part
    await part.update({ revisionLocked: true });

    // Record history for the new part
    await db.PartRevisionHistory.create({
      partID: newPart.id,
      changedByUserID: req.user?.id || null,
      changeType: 'production_release',
      changes: { previousRevision: { old: null, new: part.revision }, previousPartID: { old: null, new: part.id } },
      createdAt: new Date()
    });

    // Record lock history for the source part
    await db.PartRevisionHistory.create({
      partID: part.id,
      changedByUserID: req.user?.id || null,
      changeType: 'locked',
      changes: null,
      createdAt: new Date()
    });

    res.json(newPart);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createError(409, `Part "${partName}" already has revision "${nextRev}". Existing revisions may need to be cleaned up.`));
    }
    if (error.name === 'SequelizeValidationError') {
      const details = error.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      return next(createError(400, `Validation failed: ${details}`));
    }
    next(createError(500, 'Error releasing to production: ' + error.message));
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
    next(createError(500, 'Error locking revision: ' + error.message));
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
    next(createError(500, 'Error unlocking revision: ' + error.message));
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
    next(createError(500, 'Error getting revision history: ' + error.message));
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
    next(createError(500, 'Error getting revisions: ' + error.message));
  }
};

// exports.testError = (req, res, next) => {
//   next(new RestError('TEST ERROR PLEASE IGNORE', 500))
// }