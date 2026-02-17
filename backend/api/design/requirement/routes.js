var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('requirements', 'write'), controller.create);
router.get('/', checkToken, checkPermission('requirements', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('requirements', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('requirements', 'write'), controller.update);
router.get('/:id/history', checkToken, checkPermission('requirements', 'read'), controller.getHistory);
router.put('/:id/take-ownership', checkToken, checkPermission('requirements', 'write'), controller.takeOwnership);
router.put('/:id/approve', checkToken, checkPermission('requirements', 'approve'), controller.approve);
router.put('/:id/unapprove', checkToken, checkPermission('requirements', 'approve'), controller.unapprove);
router.delete('/:id', checkToken, checkPermission('requirements', 'delete'), controller.delete);

module.exports = router;
