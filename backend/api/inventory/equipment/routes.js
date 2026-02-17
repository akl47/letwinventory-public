var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('equipment', 'read'), controller.getAllEquipment);
router.get('/:id', checkToken, checkPermission('equipment', 'read'), controller.getEquipmentByID);
router.post('/', checkToken, checkPermission('equipment', 'write'), controller.createNewEquipment);
router.post('/receive', checkToken, checkPermission('equipment', 'write'), controller.receiveEquipment);
router.put('/:id', checkToken, checkPermission('equipment', 'write'), controller.updateEquipmentByID);
router.delete('/:id', checkToken, checkPermission('equipment', 'delete'), controller.deleteEquipmentByID);

module.exports = router;
