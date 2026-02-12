var router = require('express').Router();
var controller = require('./controller');
var checkToken = require('../../middleware/checkToken');

router.get('/vapid-public-key', controller.getVapidPublicKey);
router.post('/test-notification', checkToken, controller.sendTestNotification);

module.exports = router;
