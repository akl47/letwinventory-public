var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('parts', 'read'), controller.getAllWires);
router.get('/by-part/:partId', checkToken, checkPermission('parts', 'read'), controller.getWireByPartId);
router.get('/:id', checkToken, checkPermission('parts', 'read'), controller.getWireById);
router.post('/', checkToken, checkPermission('parts', 'write'), controller.createWire);
router.put('/:id', checkToken, checkPermission('parts', 'write'), controller.updateWire);
router.delete('/:id', checkToken, checkPermission('parts', 'delete'), controller.deleteWire);

module.exports = router;
