var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/order/:orderID', checkToken, controller.getOrderItemsByOrderID);
router.post('/', [checkToken, bodyValidator.orderItem], controller.createOrderItem);
router.put('/:id', [checkToken, bodyValidator.orderItem], controller.updateOrderItem);
router.delete('/:id', checkToken, controller.deleteOrderItem);

module.exports = router;
