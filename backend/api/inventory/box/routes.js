var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/:id', checkToken, controller.getBoxByID);
router.post('/', checkToken, bodyValidator.box, controller.createNewBox);
router.put('/:id', checkToken, bodyValidator.box, controller.updateBox);

module.exports = router;