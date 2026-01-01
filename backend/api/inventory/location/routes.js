var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/higherarchy', checkToken, controller.getLocationHigherarchy);
router.get('/:id', checkToken, controller.getLocationByID);
router.post('/', checkToken, bodyValidator.location, controller.createNewLocation);
router.put('/:id', checkToken, bodyValidator.location, controller.updateLocationByID);


module.exports = router;