var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('parts', 'read'), controller.getAllCables);
router.get('/by-part/:partId', checkToken, checkPermission('parts', 'read'), controller.getCableByPartId);
router.get('/:id', checkToken, checkPermission('parts', 'read'), controller.getCableById);
router.post('/', checkToken, checkPermission('parts', 'write'), controller.createCable);
router.put('/:id', checkToken, checkPermission('parts', 'write'), controller.updateCable);
router.delete('/:id', checkToken, checkPermission('parts', 'delete'), controller.deleteCable);

module.exports = router;
