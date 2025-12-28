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

  db.OrderItem.update(req.body, {
    where: {
      id: req.params.id
    },
    returning: true
  }).then(updated => {
    res.json(updated[1]);
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
