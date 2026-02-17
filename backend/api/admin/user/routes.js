var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('admin', 'read'), controller.getAll);
router.post('/', checkToken, checkPermission('admin', 'write'), controller.create);
router.get('/:id', checkToken, checkPermission('admin', 'read'), controller.getById);
router.put('/:id/permissions', checkToken, checkPermission('admin', 'write'), controller.setPermissions);
router.post('/:id/impersonate', checkToken, checkPermission('admin', 'impersonate'), controller.impersonate);
router.delete('/:id', checkToken, checkPermission('admin', 'delete'), controller.deactivate);
router.put('/:id/active', checkToken, checkPermission('admin', 'write'), controller.activate);

module.exports = router;
