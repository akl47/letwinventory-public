var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('parts', 'read'), controller.getAllConnectors);
router.get('/pin-types', checkToken, checkPermission('parts', 'read'), controller.getAllPinTypes);
router.get('/by-part/:partId', checkToken, checkPermission('parts', 'read'), controller.getConnectorByPartId);
router.get('/:id', checkToken, checkPermission('parts', 'read'), controller.getConnectorById);
router.post('/', checkToken, checkPermission('parts', 'write'), controller.createConnector);
router.put('/:id', checkToken, checkPermission('parts', 'write'), controller.updateConnector);
router.delete('/:id', checkToken, checkPermission('parts', 'delete'), controller.deleteConnector);

module.exports = router;
