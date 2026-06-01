const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/parts-with-cad', checkToken, checkPermission('cad', 'read'), controller.listPartsWithCad);
router.get('/by-part/:partID', checkToken, checkPermission('cad', 'read'), controller.listByPart);
router.get('/by-part/:partID/active', checkToken, checkPermission('cad', 'read'), controller.getActiveByPart);
router.post('/by-part/:partID', checkToken, checkPermission('cad', 'write'), controller.createForPart);

router.get('/:id', checkToken, checkPermission('cad', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('cad', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('cad', 'delete'), controller.delete);

router.post('/:id/submit', checkToken, checkPermission('cad', 'write'), controller.submit);
router.post('/:id/release', checkToken, checkPermission('cad', 'approve'), controller.release);
router.post('/:id/new-revision', checkToken, checkPermission('cad', 'write'), controller.newRevision);

router.get('/:id/history', checkToken, checkPermission('cad', 'read'), controller.getHistory);

// VCS: checkout (exclusive lock), check-in (commit), release/force-unlock, log.
router.post('/:id/checkout', checkToken, checkPermission('cad', 'write'), controller.checkout);
router.post('/:id/checkin', checkToken, checkPermission('cad', 'write'), controller.checkin);
router.post('/:id/release-lock', checkToken, checkPermission('cad', 'write'), controller.releaseLock);
router.post('/:id/force-unlock', checkToken, checkPermission('cad', 'approve'), controller.forceUnlock);
router.get('/:id/commits', checkToken, checkPermission('cad', 'read'), controller.getCommits);

// Phase 1 — server-side regeneration. Walks the feature tree, hits the
// Postgres-backed BRep cache, falls through to the Rust kernel on miss.
// Returns tessellated face meshes for the viewer to render.
router.post('/:id/regenerate', checkToken, checkPermission('cad', 'read'), controller.regenerate);
router.get('/:id/export/step', checkToken, checkPermission('cad', 'read'), controller.exportStep);

module.exports = router;
