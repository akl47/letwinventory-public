const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('tools', 'read'), controller.list);
router.post('/', checkToken, checkPermission('admin', 'manage_tool_categories'), controller.create);
router.put('/:id', checkToken, checkPermission('admin', 'manage_tool_categories'), controller.update);
router.delete('/:id', checkToken, checkPermission('admin', 'manage_tool_categories'), controller.remove);

module.exports = router;
