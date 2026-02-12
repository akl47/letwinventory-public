var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/', checkToken, controller.subscribe);
router.get('/', checkToken, controller.getSubscriptions);
router.delete('/:id', checkToken, controller.unsubscribe);

module.exports = router;
