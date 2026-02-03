var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

// List and lookup
router.get('/', checkToken, controller.getAllHarnesses);
router.get('/next-part-number', checkToken, controller.getNextPartNumber);
router.get('/sub-harness-data', checkToken, controller.getSubHarnessData);
router.get('/:id', checkToken, controller.getHarnessById);
router.get('/:id/parents', checkToken, controller.getParentHarnesses);

// CRUD
router.post('/', checkToken, controller.createHarness);
router.post('/validate', checkToken, controller.validateHarness);
router.put('/:id', checkToken, controller.updateHarness);
router.delete('/:id', checkToken, controller.deleteHarness);

// Revision control
router.get('/:id/history', checkToken, controller.getHistory);
router.get('/:id/revisions', checkToken, controller.getAllRevisions);
router.post('/:id/submit-review', checkToken, controller.submitForReview);
router.post('/:id/reject', checkToken, controller.rejectHarness);
router.post('/:id/release', checkToken, controller.releaseHarness);
router.post('/:id/release-production', checkToken, controller.releaseProduction);
router.post('/:id/revert/:historyId', checkToken, controller.revertToSnapshot);

module.exports = router;
