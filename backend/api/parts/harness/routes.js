var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// List and lookup
router.get('/', checkToken, checkPermission('harness', 'read'), controller.getAllHarnesses);
router.get('/next-part-number', checkToken, checkPermission('harness', 'read'), controller.getNextPartNumber);
router.get('/sub-harness-data', checkToken, checkPermission('harness', 'read'), controller.getSubHarnessData);
router.get('/by-part/:partID/active', checkToken, checkPermission('harness', 'read'), controller.getActiveByPart);
router.get('/:id', checkToken, checkPermission('harness', 'read'), controller.getHarnessById);
router.get('/:id/parents', checkToken, checkPermission('harness', 'read'), controller.getParentHarnesses);

// CRUD
router.post('/', checkToken, checkPermission('harness', 'write'), controller.createHarness);
router.post('/validate', checkToken, checkPermission('harness', 'read'), controller.validateHarness);
router.put('/:id', checkToken, checkPermission('harness', 'write'), controller.updateHarness);
router.delete('/:id', checkToken, checkPermission('harness', 'delete'), controller.deleteHarness);

// History
router.get('/:id/history', checkToken, checkPermission('harness', 'read'), controller.getHistory);
router.get('/:id/revisions', checkToken, checkPermission('harness', 'read'), controller.getAllRevisions);

// Version control — the CAD workflow (REQ 1062–1066): checkout (exclusive
// lock), check-in (commit), draft branches, release, production release.
router.post('/:id/checkout', checkToken, checkPermission('harness', 'write'), controller.checkout);
router.post('/:id/checkin', checkToken, checkPermission('harness', 'write'), controller.checkin);
router.post('/:id/undo-checkout', checkToken, checkPermission('harness', 'write'), controller.undoCheckout);
router.post('/:id/renew-lock', checkToken, checkPermission('harness', 'write'), controller.renewLock);
router.post('/:id/force-unlock', checkToken, checkPermission('harness', 'approve'), controller.forceUnlock);
router.get('/:id/commits', checkToken, checkPermission('harness', 'read'), controller.getCommits);
router.get('/:id/working-diff', checkToken, checkPermission('harness', 'read'), controller.getWorkingDiff);
router.get('/:id/graph', checkToken, checkPermission('harness', 'read'), controller.getGraph);
router.get('/:id/commits/:a/diff/:b', checkToken, checkPermission('harness', 'read'), controller.getCommitDiff);
router.get('/:id/commits/:hash/doc', checkToken, checkPermission('harness', 'read'), controller.getCommitDoc);

router.get('/:id/branches', checkToken, checkPermission('harness', 'read'), controller.listBranches);
router.post('/:id/branches', checkToken, checkPermission('harness', 'write'), controller.createBranch);
router.post('/:id/switch-branch', checkToken, checkPermission('harness', 'write'), controller.switchBranch);
router.delete('/:id/branches/:name', checkToken, checkPermission('harness', 'write'), controller.archiveBranch);

// Review workflow (transition permissions enforced by the engine).
router.get('/:id/workflow', checkToken, checkPermission('harness', 'read'), controller.getWorkflow);
router.post('/:id/workflow', checkToken, checkPermission('harness', 'read'), controller.transitionWorkflow);

router.post('/:id/release', checkToken, checkPermission('harness', 'write'), controller.releaseHarness);
router.post('/:id/production-release', checkToken, checkPermission('harness', 'approve'), controller.productionRelease);

module.exports = router;
