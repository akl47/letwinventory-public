var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/higherarchy', checkToken, checkPermission('inventory', 'read'), controller.getLocationHigherarchy);
router.get('/:id', checkToken, checkPermission('inventory', 'read'), controller.getLocationByID);
router.post('/', checkToken, checkPermission('inventory', 'write'), bodyValidator.location, controller.createNewLocation);
router.put('/:id', checkToken, checkPermission('inventory', 'write'), bodyValidator.location, controller.updateLocationByID);


module.exports = router;