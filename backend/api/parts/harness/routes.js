var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// List and lookup
router.get('/', checkToken, checkPermission('harness', 'read'), controller.getAllHarnesses);
router.get('/next-part-number', checkToken, checkPermission('harness', 'read'), controller.getNextPartNumber);
router.get('/sub-harness-data', checkToken, checkPermission('harness', 'read'), controller.getSubHarnessData);
router.get('/:id', checkToken, checkPermission('harness', 'read'), controller.getHarnessById);
router.get('/:id/parents', checkToken, checkPermission('harness', 'read'), controller.getParentHarnesses);

// CRUD
router.post('/', checkToken, checkPermission('harness', 'write'), controller.createHarness);
router.post('/validate', checkToken, checkPermission('harness', 'read'), controller.validateHarness);
router.put('/:id', checkToken, checkPermission('harness', 'write'), controller.updateHarness);
router.delete('/:id', checkToken, checkPermission('harness', 'delete'), controller.deleteHarness);

// Revision control
router.get('/:id/history', checkToken, checkPermission('harness', 'read'), controller.getHistory);
router.get('/:id/revisions', checkToken, checkPermission('harness', 'read'), controller.getAllRevisions);
router.post('/:id/submit-review', checkToken, checkPermission('harness', 'write'), controller.submitForReview);
router.post('/:id/reject', checkToken, checkPermission('harness', 'write'), controller.rejectHarness);
router.post('/:id/release', checkToken, checkPermission('harness', 'write'), controller.releaseHarness);
router.post('/:id/release-production', checkToken, checkPermission('harness', 'write'), controller.releaseProduction);
router.post('/:id/revert/:historyId', checkToken, checkPermission('harness', 'write'), controller.revertToSnapshot);

module.exports = router;
