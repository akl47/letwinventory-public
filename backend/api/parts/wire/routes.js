var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllWires);
router.get('/by-part/:partId', checkToken, controller.getWireByPartId);
router.get('/:id', checkToken, controller.getWireById);
router.post('/', checkToken, controller.createWire);
router.put('/:id', checkToken, controller.updateWire);
router.delete('/:id', checkToken, controller.deleteWire);

module.exports = router;
