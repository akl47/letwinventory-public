var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllConnectors);
router.get('/by-part/:partId', checkToken, controller.getConnectorByPartId);
router.get('/:id', checkToken, controller.getConnectorById);
router.post('/', checkToken, controller.createConnector);
router.put('/:id', checkToken, controller.updateConnector);
router.delete('/:id', checkToken, controller.deleteConnector);

module.exports = router;
