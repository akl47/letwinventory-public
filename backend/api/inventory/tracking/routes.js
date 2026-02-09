var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllTrackings);
router.get('/:id', checkToken, controller.getTrackingById);
router.post('/', checkToken, controller.createTracking);
router.put('/:id', checkToken, controller.updateTracking);
router.delete('/:id', checkToken, controller.deleteTracking);
router.post('/:id/refresh', checkToken, controller.refreshTracking);

module.exports = router;
