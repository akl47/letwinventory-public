var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('admin', 'read'), controller.getAllWireEnds);
router.get('/by-code/:code', checkToken, checkPermission('admin', 'read'), controller.getWireEndByCode);
router.get('/:id', checkToken, checkPermission('admin', 'read'), controller.getWireEndById);
router.post('/', checkToken, checkPermission('admin', 'write'), controller.createWireEnd);
router.put('/:id', checkToken, checkPermission('admin', 'write'), controller.updateWireEnd);
router.delete('/:id', checkToken, checkPermission('admin', 'delete'), controller.deleteWireEnd);

module.exports = router;
