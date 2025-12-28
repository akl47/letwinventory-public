var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/:id', controller.getBoxByID); //Needs Check Token
router.post('/', [bodyValidator.box], controller.createNewBox); //Needs Check Token
router.put('/:id', [bodyValidator.box], controller.updateBox); //Needs Check Token

module.exports = router;