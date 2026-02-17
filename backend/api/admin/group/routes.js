var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('admin', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('admin', 'read'), controller.getById);
router.post('/', checkToken, checkPermission('admin', 'write'), controller.create);
router.put('/:id', checkToken, checkPermission('admin', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('admin', 'delete'), controller.delete);
router.post('/:id/member', checkToken, checkPermission('admin', 'write'), controller.addMember);
router.delete('/:id/member/:userId', checkToken, checkPermission('admin', 'write'), controller.removeMember);

module.exports = router;
