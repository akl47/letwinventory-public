var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllWireEnds);
router.get('/by-code/:code', checkToken, controller.getWireEndByCode);
router.get('/:id', checkToken, controller.getWireEndById);
router.post('/', checkToken, controller.createWireEnd);
router.put('/:id', checkToken, controller.updateWireEnd);
router.delete('/:id', checkToken, controller.deleteWireEnd);

module.exports = router;
