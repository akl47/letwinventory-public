var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/', checkToken, checkPermission('orders', 'read'), controller.getAllOrders);
router.get('/statuses', checkToken, checkPermission('orders', 'read'), controller.getOrderStatuses);
router.get('/line-types', checkToken, checkPermission('orders', 'read'), controller.getOrderLineTypes);
router.get('/:id', checkToken, checkPermission('orders', 'read'), controller.getOrderById);
router.post('/bulk-import', checkToken, checkPermission('orders', 'write'), controller.bulkImport);
router.post('/', [checkToken, checkPermission('orders', 'write'), bodyValidator.order], controller.createNewOrder);
router.put('/:id', [checkToken, checkPermission('orders', 'write'), bodyValidator.order], controller.updateOrderByID);
router.delete('/:id', checkToken, checkPermission('orders', 'delete'), controller.deleteOrderByID);

module.exports = router;
