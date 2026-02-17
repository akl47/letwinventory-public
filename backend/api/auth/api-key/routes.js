const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken');

router.post('/', checkToken, controller.create);
router.get('/', checkToken, controller.list);
router.delete('/:id', checkToken, controller.revoke);
router.get('/:id/permissions', checkToken, controller.getPermissions);
router.post('/token', controller.exchangeToken);

module.exports = router;
