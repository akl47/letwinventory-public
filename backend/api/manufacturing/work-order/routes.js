var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// List and lookup
router.get('/', checkToken, checkPermission('manufacturing_execution', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('manufacturing_execution', 'read'), controller.getById);
router.get('/:id/kit-status', checkToken, checkPermission('manufacturing_execution', 'read'), controller.getKitStatus);

// CRUD
router.post('/', checkToken, checkPermission('manufacturing_execution', 'write'), controller.create);
router.delete('/:id', checkToken, checkPermission('manufacturing_execution', 'delete'), controller.remove);

// Step execution
router.post('/:id/complete-step', checkToken, checkPermission('manufacturing_execution', 'write'), controller.completeStep);
router.post('/:id/uncomplete-step', checkToken, checkPermission('manufacturing_execution', 'write'), controller.uncompleteStep);
router.post('/:id/complete', checkToken, checkPermission('manufacturing_execution', 'write'), controller.complete);

module.exports = router;
