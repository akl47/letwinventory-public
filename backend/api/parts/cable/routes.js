var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllCables);
router.get('/by-part/:partId', checkToken, controller.getCableByPartId);
router.get('/:id', checkToken, controller.getCableById);
router.post('/', checkToken, controller.createCable);
router.put('/:id', checkToken, controller.updateCable);
router.delete('/:id', checkToken, controller.deleteCable);

module.exports = router;
