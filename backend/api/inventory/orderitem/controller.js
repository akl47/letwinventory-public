const db = require('../../../models');
const createError = require('http-errors');

// Helper function to recalculate and update order status based on received quantities
async function recalculateOrderStatus(orderID) {
  try {
    // Get all active order items for this order
    const orderItems = await db.OrderItem.findAll({
      where: {
        orderID: orderID,
        activeFlag: true,
        orderLineTypeID: 1 // Only Part line items
      }
    });

    if (orderItems.length === 0) return;

    let allFullyReceived = true;
    let anyReceived = false;

    for (const item of orderItems) {
      const received = item.receivedQuantity || 0;
      if (received < item.quantity) {
        allFullyReceived = false;
      }
      if (received > 0) {
        anyReceived = true;
      }
    }

    // Get current order
    const order = await db.Order.findByPk(orderID);
    if (!order) return;

    // Determine new status: 4 = Received, 5 = Partially Received
    let newStatusId = order.orderStatusID;
    if (allFullyReceived) {
      newStatusId = 4; // Received
    } else if (anyReceived) {
      newStatusId = 5; // Partially Received
    }

    // Only update if status changed and order is in a receivable state (Shipped or Partially Received)
    if (newStatusId !== order.orderStatusID && (order.orderStatusID === 3 || order.orderStatusID === 5)) {
      const updateData = { orderStatusID: newStatusId };
      if (allFullyReceived) {
        updateData.receivedDate = new Date();
      }
      await db.Order.update(updateData, {
        where: { id: orderID }
      });
    }
  } catch (error) {
    console.error('Error recalculating order status:', error);
  }
}

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
    lineNumber: req.body.lineNumber,
    quantity: req.body.quantity,
    price: req.body.price,
    name: req.body.name, // For non-Part items
    receivedQuantity: req.body.receivedQuantity || 0
  }).then(item => {
    // Fetch the created record with related data
    return db.OrderItem.findOne({
      where: { id: item.id },
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
    next(createError(500, 'Error Creating Order Item: ' + error));
  });
};

exports.updateOrderItem = async (req, res, next) => {
  try {
    // Validation: if orderLineTypeID is 1 (Part), partID is required
    if (req.body.orderLineTypeID === 1 && !req.body.partID) {
      return next(createError(400, 'partID is required for Part line items'));
    }

    const itemId = parseInt(req.params.id, 10);

    // Get the order item first to know its orderID
    const existingItem = await db.OrderItem.findByPk(itemId);
    if (!existingItem) {
      return next(createError(404, 'Order Item not found'));
    }

    // Ensure numeric fields are properly typed - only include fields that were explicitly provided
    const updateData = {};
    const receivedQuantityUpdated = req.body.receivedQuantity !== undefined;

    if (req.body.quantity !== undefined) {
      updateData.quantity = parseInt(req.body.quantity, 10);
    }
    if (req.body.price !== undefined) {
      updateData.price = parseFloat(req.body.price);
    }
    if (req.body.orderLineTypeID !== undefined) {
      updateData.orderLineTypeID = parseInt(req.body.orderLineTypeID, 10);
    }
    // Only update partID if it was explicitly provided in the request
    if ('partID' in req.body) {
      updateData.partID = req.body.partID ? parseInt(req.body.partID, 10) : null;
    }
    if (req.body.lineNumber !== undefined) {
      updateData.lineNumber = parseInt(req.body.lineNumber, 10);
    }
    if (receivedQuantityUpdated) {
      updateData.receivedQuantity = parseInt(req.body.receivedQuantity, 10);
    }
    if (req.body.name !== undefined) {
      updateData.name = req.body.name;
    }

    // Update the order item
    await db.OrderItem.update(updateData, {
      where: { id: itemId }
    });

    // If receivedQuantity was updated, recalculate order status
    if (receivedQuantityUpdated) {
      await recalculateOrderStatus(existingItem.orderID);
    }

    // Fetch the updated record with related data
    const item = await db.OrderItem.findOne({
      where: { id: itemId },
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

    res.json(item);
  } catch (error) {
    next(createError(500, 'Error Updating Order Item: ' + error));
  }
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
