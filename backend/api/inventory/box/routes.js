var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/:id', checkToken, checkPermission('inventory', 'read'), controller.getBoxByID);
router.post('/', checkToken, checkPermission('inventory', 'write'), bodyValidator.box, controller.createNewBox);
router.put('/:id', checkToken, checkPermission('inventory', 'write'), bodyValidator.box, controller.updateBox);

module.exports = router;