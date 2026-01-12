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
            attributes: ['id', 'name', 'description', 'vendor', 'sku']
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
            attributes: ['id', 'name', 'description', 'vendor', 'sku']
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
