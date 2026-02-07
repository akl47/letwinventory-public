const db = require('../../../models');
const createError = require('http-errors');

exports.getAllOrders = (req, res, next) => {
  db.Order.findAll({
    order: [
      ['id', 'DESC']
    ],
    include: [
      {
        model: db.OrderStatus,
        attributes: ['id', 'name', 'tagColor', 'nextStatusID']
      },
      {
        model: db.OrderItem,
        where: {
          activeFlag: true
        },
        required: false,
        order: [['lineNumber', 'ASC']],
        include: [
          {
            model: db.Part,
            attributes: ['id', 'name', 'description', 'vendor', 'sku', 'partCategoryID', 'imageFileID'],
            include: [
              {
                model: db.PartCategory,
                attributes: ['id', 'name']
              },
              {
                model: db.UploadedFile,
                as: 'imageFile',
                attributes: ['id', 'filename', 'mimeType', 'data']
              }
            ]
          },
          {
            model: db.OrderLineType,
            attributes: ['id', 'name']
          }
        ]
      }
    ]
  }).then(orders => {
    res.json(orders);
  }).catch(error => {
    next(createError(500, 'Error Getting Orders: ' + error));
  });
};

exports.getOrderById = (req, res, next) => {
  db.Order.findOne({
    where: {
      id: req.params.id
    },
    include: [
      {
        model: db.OrderStatus,
        attributes: ['id', 'name', 'tagColor', 'nextStatusID']
      },
      {
        model: db.OrderItem,
        where: {
          activeFlag: true
        },
        required: false,
        order: [['lineNumber', 'ASC']],
        include: [
          {
            model: db.Part,
            attributes: ['id', 'name', 'description', 'vendor', 'sku', 'partCategoryID', 'imageFileID'],
            include: [
              {
                model: db.PartCategory,
                attributes: ['id', 'name']
              },
              {
                model: db.UploadedFile,
                as: 'imageFile',
                attributes: ['id', 'filename', 'mimeType', 'data']
              }
            ]
          },
          {
            model: db.OrderLineType,
            attributes: ['id', 'name']
          },
          {
            model: db.Trace,
            where: { activeFlag: true },
            required: false,
            include: [
              {
                model: db.Barcode,
                attributes: ['id', 'barcode']
              }
            ]
          },
          {
            model: db.Equipment,
            as: 'Equipment',
            attributes: ['id', 'name', 'description', 'serialNumber', 'commissionDate', 'barcodeID'],
            include: [
              {
                model: db.Barcode,
                attributes: ['id', 'barcode']
              }
            ]
          }
        ]
      }
    ]
  }).then(order => {
    if (!order) {
      return next(createError(404, 'Order not found'));
    }
    res.json(order);
  }).catch(error => {
    next(createError(500, 'Error Getting Order: ' + error));
  });
};

exports.createNewOrder = (req, res, next) => {
  db.Order.create({
    description: req.body.description,
    vendor: req.body.vendor,
    trackingNumber: req.body.trackingNumber,
    link: req.body.link,
    notes: req.body.notes,
    placedDate: req.body.placedDate,
    receivedDate: req.body.receivedDate,
    orderStatusID: req.body.orderStatusID
  }).then(order => {
    res.json(order);
  }).catch(error => {
    next(createError(500, 'Error Creating Order: ' + error));
  });
};

exports.updateOrderByID = (req, res, next) => {
  db.Order.update(req.body, {
    where: {
      id: req.params.id
    },
    returning: true
  }).then(updated => {
    res.json(updated[1]);
  }).catch(error => {
    next(createError(500, 'Error Updating Order: ' + error));
  });
};

exports.deleteOrderByID = (req, res, next) => {
  db.Order.findOne({
    where: {
      id: req.params.id,
      activeFlag: true
    }
  }).then(order => {
    if (!order) {
      return next(createError(404, 'Order not found'));
    }
    order = order.toJSON();
    order.activeFlag = false;
    db.Order.update(order, {
      where: {
        id: req.params.id,
        activeFlag: true
      }
    }).then(deletedOrder => {
      res.json(deletedOrder);
    }).catch(error => {
      next(createError(500, 'Error Deleting Order: ' + error));
    });
  }).catch(error => {
    next(createError(500, 'Error Finding Order: ' + error));
  });
};

exports.getOrderStatuses = (req, res, next) => {
  db.OrderStatus.findAll({
    where: { activeFlag: true },
    attributes: ['id', 'name', 'tagColor', 'nextStatusID'],
    order: [['id', 'ASC']]
  }).then(statuses => {
    res.json(statuses);
  }).catch(error => {
    next(createError(500, 'Error Getting Order Statuses: ' + error));
  });
};

exports.getOrderLineTypes = (req, res, next) => {
  db.OrderLineType.findAll({
    where: { activeFlag: true },
    attributes: ['id', 'name'],
    order: [['id', 'ASC']]
  }).then(lineTypes => {
    res.json(lineTypes);
  }).catch(error => {
    next(createError(500, 'Error Getting Order Line Types: ' + error));
  });
};

/**
 * Parse a CSV line, handling quoted fields with commas
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

/**
 * Parse CSV content into array of objects
 */
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const record = {};
    headers.forEach((header, index) => {
      record[header.trim()] = values[index]?.trim() || '';
    });
    records.push(record);
  }
  return records;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
}

function parsePrice(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    return parseFloat(value.replace(/[$,]/g, '')) || 0;
  }
  return 0;
}

function parseIntValue(value, defaultValue = 1) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Bulk import parts and create order from CSV or pre-edited items
 * POST /api/inventory/order/bulk-import
 * Query params: dryRun=true for preview mode
 * Body (CSV mode): { csvContent: string, vendor?: string, orderDescription?: string, ... }
 * Body (Edit mode): { items: array, orderData: object }
 */
exports.bulkImport = async (req, res, next) => {
  const dryRun = req.query.dryRun === 'true';
  const { csvContent, items, orderData, vendor: overrideVendor, orderDescription } = req.body;

  // Determine mode: CSV parsing or pre-edited items
  const useEditedItems = Array.isArray(items) && items.length > 0;

  if (!csvContent && !useEditedItems) {
    return next(createError(400, 'CSV content or items array is required'));
  }

  let records = [];
  let vendor = overrideVendor || 'Unknown Vendor';

  if (useEditedItems) {
    // Use pre-edited items directly
    records = items;
    vendor = orderData?.vendor || overrideVendor || 'Unknown Vendor';
  } else {
    // Parse from CSV
    records = parseCSV(csvContent);
    if (records.length === 0) {
      return next(createError(400, 'CSV file is empty or has no data rows'));
    }
    vendor = overrideVendor || records[0].vendor || 'Unknown Vendor';
  }

  const results = {
    partsToCreate: [],
    partsExisting: [],
    partsSkipped: [],
    orderItems: [],
    orderTotal: 0,
    order: null
  };

  const transaction = dryRun ? null : await db.sequelize.transaction();

  try {
    // Process each part/item
    for (const record of records) {
      const partName = (record.name || record.partName)?.trim();

      if (!partName) {
        results.partsSkipped.push({ reason: 'Empty name', record });
        continue;
      }

      const existingPart = await db.Part.findOne({
        where: { name: partName },
        transaction
      });

      let part;

      if (existingPart) {
        results.partsExisting.push({
          id: existingPart.id,
          name: existingPart.name,
          description: existingPart.description,
          vendor: existingPart.vendor,
          sku: existingPart.sku,
          manufacturer: existingPart.manufacturer,
          manufacturerPN: existingPart.manufacturerPN
        });
        part = existingPart;
        // Use the existing part's description
        record.description = existingPart.description;
      } else {
        const partData = {
          name: partName.substring(0, 16),
          description: (record.description || '')?.substring(0, 62),
          internalPart: parseBoolean(record.internalPart),
          vendor: record.vendor || vendor,
          sku: record.sku || null,
          link: record.link || null,
          activeFlag: record.activeFlag === undefined || record.activeFlag === '' ? true : parseBoolean(record.activeFlag),
          minimumOrderQuantity: parseIntValue(record.minimumOrderQuantity, 1),
          partCategoryID: parseIntValue(record.partCategoryID, 1),
          serialNumberRequired: parseBoolean(record.serialNumberRequired),
          lotNumberRequired: parseBoolean(record.lotNumberRequired),
          defaultUnitOfMeasureID: parseIntValue(record.defaultUnitOfMeasureID, 1),
          manufacturer: record.manufacturer || null,
          manufacturerPN: record.manufacturerPN || null,
        };

        // Vendor parts require manufacturer info
        if (!partData.internalPart && (!partData.manufacturer || !partData.manufacturerPN)) {
          partData.manufacturer = partData.manufacturer || partData.vendor;
          partData.manufacturerPN = partData.manufacturerPN || partData.name;
        }

        if (dryRun) {
          part = { id: null, ...partData };
          results.partsToCreate.push(partData);
        } else {
          part = await db.Part.create(partData, { transaction });
          results.partsToCreate.push({
            id: part.id,
            name: part.name,
            description: part.description,
            vendor: part.vendor
          });
        }
      }

      const qty = parseIntValue(record.qty || record.quantity, 1);
      const price = parsePrice(record.price);
      const lineTotal = qty * price;

      results.orderItems.push({
        partId: part.id,
        partName: partName,
        description: (record.description || '')?.substring(0, 62),
        quantity: qty,
        price: price,
        lineTotal: lineTotal,
        isNew: !existingPart,
        partCategoryID: part.partCategoryID,
        vendor: part.vendor || record.vendor || vendor,
        sku: part.sku || record.sku || null,
        manufacturer: part.manufacturer || record.manufacturer || null,
        manufacturerPN: part.manufacturerPN || record.manufacturerPN || null,
        internalPart: part.internalPart ?? parseBoolean(record.internalPart)
      });

      results.orderTotal += lineTotal;
    }

    // Create order
    const finalOrderData = orderData || {};
    const description = finalOrderData.description || orderDescription || `${vendor} Order - Bulk Import`;

    if (dryRun) {
      results.order = { id: null, description, vendor };
    } else {
      const order = await db.Order.create({
        description: description,
        vendor: finalOrderData.vendor || vendor,
        trackingNumber: finalOrderData.trackingNumber || null,
        link: finalOrderData.link || null,
        notes: finalOrderData.notes || null,
        placedDate: finalOrderData.placedDate || null,
        orderStatusID: finalOrderData.orderStatusID || 1,
        activeFlag: true,
      }, { transaction });

      results.order = { id: order.id, description, vendor: order.vendor };

      // Create order items
      let lineNumber = 1;
      for (const item of results.orderItems) {
        await db.OrderItem.create({
          orderID: order.id,
          partID: item.partId,
          orderLineTypeID: 1,
          lineNumber: lineNumber,
          quantity: item.quantity,
          receivedQuantity: 0,
          price: item.price,
          activeFlag: true,
        }, { transaction });
        lineNumber++;
      }

      await transaction.commit();
    }

    res.json({
      dryRun,
      ...results
    });

  } catch (error) {
    if (!dryRun && transaction) {
      await transaction.rollback();
    }
    next(createError(500, 'Error during bulk import: ' + error.message));
  }
};
