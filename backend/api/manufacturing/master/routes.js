var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// List and lookup
router.get('/', checkToken, checkPermission('manufacturing_planning', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('manufacturing_planning', 'read'), controller.getById);
router.get('/:id/history', checkToken, checkPermission('manufacturing_planning', 'read'), controller.getHistory);
router.get('/:id/revisions', checkToken, checkPermission('manufacturing_planning', 'read'), controller.getRevisions);

// CRUD
router.post('/', checkToken, checkPermission('manufacturing_planning', 'write'), controller.create);
router.put('/:id', checkToken, checkPermission('manufacturing_planning', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('manufacturing_planning', 'delete'), controller.remove);

// BOM
router.put('/:id/bom', checkToken, checkPermission('manufacturing_planning', 'write'), controller.updateBom);

// Release workflow
router.post('/:id/submit-review', checkToken, checkPermission('manufacturing_planning', 'write'), controller.submitForReview);
router.post('/:id/reject', checkToken, checkPermission('manufacturing_planning', 'write'), controller.reject);
router.post('/:id/release', checkToken, checkPermission('manufacturing_planning', 'write'), controller.release);
router.post('/:id/new-revision', checkToken, checkPermission('manufacturing_planning', 'write'), controller.newRevision);

module.exports = router;
