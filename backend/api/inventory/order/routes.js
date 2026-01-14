var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/', checkToken, controller.getAllOrders);
router.get('/statuses', checkToken, controller.getOrderStatuses);
router.get('/line-types', checkToken, controller.getOrderLineTypes);
router.get('/:id', checkToken, controller.getOrderById);
router.post('/', [checkToken, bodyValidator.order], controller.createNewOrder);
router.put('/:id', [checkToken, bodyValidator.order], controller.updateOrderByID);
router.delete('/:id', checkToken, controller.deleteOrderByID);

module.exports = router;
