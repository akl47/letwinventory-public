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

// Release = commit + freeze + tag the commit with Parts.revision (VC-18).
router.post('/:id/release', checkToken, checkPermission('cad', 'approve'), controller.release);

router.get('/:id/history', checkToken, checkPermission('cad', 'read'), controller.getHistory);

// VCS: checkout (exclusive lock), check-in (commit), release/force-unlock, log.
router.post('/:id/checkout', checkToken, checkPermission('cad', 'write'), controller.checkout);
router.post('/:id/checkin', checkToken, checkPermission('cad', 'write'), controller.checkin);
router.post('/:id/release-lock', checkToken, checkPermission('cad', 'write'), controller.releaseLock);
router.post('/:id/force-unlock', checkToken, checkPermission('cad', 'approve'), controller.forceUnlock);
router.get('/:id/commits', checkToken, checkPermission('cad', 'read'), controller.getCommits);

// VCS Phase 2: variant branches + cherry-pick (no merge).
router.get('/:id/branches', checkToken, checkPermission('cad', 'read'), controller.listBranches);
router.post('/:id/branches', checkToken, checkPermission('cad', 'write'), controller.createBranch);
router.post('/:id/switch-branch', checkToken, checkPermission('cad', 'write'), controller.switchBranch);
router.delete('/:id/branches/:name', checkToken, checkPermission('cad', 'write'), controller.archiveBranch);
router.post('/:id/cherry-pick', checkToken, checkPermission('cad', 'write'), controller.cherryPick);

// VCS Phase 3: structural + 3D diff between two commits.
router.get('/:id/commits/:a/diff/:b', checkToken, checkPermission('cad', 'read'), controller.getCommitDiff);
router.post('/:id/commits/:a/diff/:b/regen', checkToken, checkPermission('cad', 'read'), controller.getBodyDiff3D);

// Phase 1 — server-side regeneration. Walks the feature tree, hits the
// Postgres-backed BRep cache, falls through to the Rust kernel on miss.
// Returns tessellated face meshes for the viewer to render.
router.post('/:id/regenerate', checkToken, checkPermission('cad', 'read'), controller.regenerate);
router.get('/:id/export/step', checkToken, checkPermission('cad', 'read'), controller.exportStep);

module.exports = router;
