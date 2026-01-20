var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllEquipment);
router.get('/:id', checkToken, controller.getEquipmentByID);
router.post('/', checkToken, controller.createNewEquipment);
router.post('/receive', checkToken, controller.receiveEquipment);
router.put('/:id', checkToken, controller.updateEquipmentByID);
router.delete('/:id', checkToken, controller.deleteEquipmentByID);

module.exports = router;
