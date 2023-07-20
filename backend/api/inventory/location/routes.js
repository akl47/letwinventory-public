var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/higherarchy', controller.getLocationHigherarchy); //Needs Check Token
router.get('/:id', controller.getLocationByID); //Needs Check Token
router.post('/', [bodyValidator.location], controller.createNewLocation); //Needs Check Token
router.put('/:id', [bodyValidator.location], controller.updateLocationByID); //Needs Check Token


module.exports = router;