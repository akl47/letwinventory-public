var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/order/:orderID', checkToken, checkPermission('orders', 'read'), controller.getOrderItemsByOrderID);
router.post('/', [checkToken, checkPermission('orders', 'write'), bodyValidator.orderItem], controller.createOrderItem);
router.put('/:id', [checkToken, checkPermission('orders', 'write'), bodyValidator.orderItem], controller.updateOrderItem);
router.delete('/:id', checkToken, checkPermission('orders', 'delete'), controller.deleteOrderItem);

module.exports = router;
