const db = require('../../../models');
const createError = require('http-errors');

exports.getOrderItemsByOrderID = (req, res, next) => {
  db.OrderItem.findAll({
    where: {
      orderID: req.params.orderID,
      activeFlag: true
    },
    include: [
      {
        model: db.Part,
        attributes: ['id', 'name', 'description', 'vendor', 'sku']
      },
      {
        model: db.OrderLineType,
        attributes: ['id', 'name']
      }
    ]
  }).then(items => {
    res.json(items);
  }).catch(error => {
    next(createError(500, 'Error Getting Order Items: ' + error));
  });
};

exports.createOrderItem = (req, res, next) => {
  // Validation: if orderLineTypeID is 1 (Part), partID is required
  if (req.body.orderLineTypeID === 1 && !req.body.partID) {
    return next(createError(400, 'partID is required for Part line items'));
  }

  db.OrderItem.create({
    orderID: req.body.orderID,
    partID: req.body.partID,
    orderLineTypeID: req.body.orderLineTypeID,
    quantity: req.body.quantity,
    price: req.body.price,
    name: req.body.name // For non-Part items
  }).then(item => {
    res.json(item);
  }).catch(error => {
    next(createError(500, 'Error Creating Order Item: ' + error));
  });
};

exports.updateOrderItem = (req, res, next) => {
  // Validation: if orderLineTypeID is 1 (Part), partID is required
  if (req.body.orderLineTypeID === 1 && !req.body.partID) {
    return next(createError(400, 'partID is required for Part line items'));
  }

  // Ensure numeric fields are properly typed
  const updateData = {
    ...req.body,
    quantity: req.body.quantity ? parseInt(req.body.quantity, 10) : undefined,
    price: req.body.price ? parseFloat(req.body.price) : undefined,
    orderLineTypeID: req.body.orderLineTypeID ? parseInt(req.body.orderLineTypeID, 10) : undefined,
    partID: req.body.partID ? parseInt(req.body.partID, 10) : null,
    lineNumber: req.body.lineNumber ? parseInt(req.body.lineNumber, 10) : undefined
  };

  // Remove undefined values
  Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

  db.OrderItem.update(updateData, {
    where: {
      id: parseInt(req.params.id, 10)
    }
  }).then(() => {
    // Fetch the updated record with related data
    return db.OrderItem.findOne({
      where: { id: parseInt(req.params.id, 10) },
      include: [
        {
          model: db.Part,
          attributes: ['id', 'name', 'description', 'vendor', 'sku']
        },
        {
          model: db.OrderLineType,
          attributes: ['id', 'name']
        }
      ]
    });
  }).then(item => {
    res.json(item);
  }).catch(error => {
    next(createError(500, 'Error Updating Order Item: ' + error));
  });
};

exports.deleteOrderItem = (req, res, next) => {
  db.OrderItem.findOne({
    where: {
      id: req.params.id,
      activeFlag: true
    }
  }).then(item => {
    if (!item) {
      return next(createError(404, 'Order Item not found'));
    }
    item = item.toJSON();
    item.activeFlag = false;
    db.OrderItem.update(item, {
      where: {
        id: req.params.id,
        activeFlag: true
      }
    }).then(deletedItem => {
      res.json(deletedItem);
    }).catch(error => {
      next(createError(500, 'Error Deleting Order Item: ' + error));
    });
  }).catch(error => {
    next(createError(500, 'Error Finding Order Item: ' + error));
  });
};
