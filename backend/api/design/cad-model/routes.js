const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/kernel/status', checkToken, checkPermission('cad', 'read'), controller.kernelStatus);
router.get('/parts-with-cad', checkToken, checkPermission('cad', 'read'), controller.listPartsWithCad);
router.get('/by-part/:partID', checkToken, checkPermission('cad', 'read'), controller.listByPart);
router.get('/by-part/:partID/active', checkToken, checkPermission('cad', 'read'), controller.getActiveByPart);
router.post('/by-part/:partID', checkToken, checkPermission('cad', 'write'), controller.createForPart);

router.get('/:id', checkToken, checkPermission('cad', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('cad', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('cad', 'delete'), controller.delete);

// Release = commit + freeze + tag the commit with Parts.revision (VC-18).
router.post('/:id/release', checkToken, checkPermission('cad', 'write'), controller.release);

// Two-tier release workflow. Development release is self-service (cad.write);
// release-file downloads are read-only and served from frozen geometry.
router.post('/:id/dev-release', checkToken, checkPermission('cad', 'write'), controller.devRelease);
router.post('/:id/new-revision', checkToken, checkPermission('cad', 'write'), controller.newRevision);
router.post('/:id/production-release', checkToken, checkPermission('cad', 'approve'), controller.productionRelease);
router.get('/:id/release/step', checkToken, checkPermission('cad', 'read'), controller.exportReleaseStep);
router.get('/:id/release/stl', checkToken, checkPermission('cad', 'read'), controller.exportReleaseStl);

router.get('/:id/history', checkToken, checkPermission('cad', 'read'), controller.getHistory);

// VCS: checkout (exclusive lock), check-in (commit), release/force-unlock, log.
router.post('/:id/checkout', checkToken, checkPermission('cad', 'write'), controller.checkout);
router.post('/:id/checkin', checkToken, checkPermission('cad', 'write'), controller.checkin);
router.post('/:id/undo-checkout', checkToken, checkPermission('cad', 'write'), controller.undoCheckout);
router.post('/:id/force-unlock', checkToken, checkPermission('cad', 'approve'), controller.forceUnlock);
router.get('/:id/commits', checkToken, checkPermission('cad', 'read'), controller.getCommits);
router.get('/:id/working-diff', checkToken, checkPermission('cad', 'read'), controller.getWorkingDiff);
router.get('/:id/graph', checkToken, checkPermission('cad', 'read'), controller.getGraph);

// VCS Phase 2: variant branches + cherry-pick (no merge).
router.get('/:id/branches', checkToken, checkPermission('cad', 'read'), controller.listBranches);
router.post('/:id/branches', checkToken, checkPermission('cad', 'write'), controller.createBranch);
router.post('/:id/switch-branch', checkToken, checkPermission('cad', 'write'), controller.switchBranch);
router.delete('/:id/branches/:name', checkToken, checkPermission('cad', 'write'), controller.archiveBranch);
router.post('/:id/cherry-pick', checkToken, checkPermission('cad', 'write'), controller.cherryPick);
router.post('/:id/rebase', checkToken, checkPermission('cad', 'write'), controller.rebaseBranch);
router.post('/:id/reconcile', checkToken, checkPermission('cad', 'write'), controller.reconcileBranch);
router.post('/:id/reconcile/preview', checkToken, checkPermission('cad', 'read'), controller.reconcilePreview);
// Change LIST a merge would consider (assembly rows; empty for part models).
router.get('/:id/reconcile/preview', checkToken, checkPermission('cad', 'read'), controller.reconcileChanges);

// VCS Phase 4: review workflow (transition permissions enforced by the engine).
router.get('/:id/workflow', checkToken, checkPermission('cad', 'read'), controller.getWorkflow);
router.post('/:id/workflow', checkToken, checkPermission('cad', 'read'), controller.transitionWorkflow);

// VCS Phase 3: structural + 3D diff between two commits.
router.get('/:id/commits/:a/diff/:b', checkToken, checkPermission('cad', 'read'), controller.getCommitDiff);
router.post('/:id/commits/:a/diff/:b/regen', checkToken, checkPermission('cad', 'read'), controller.getBodyDiff3D);
router.get('/:id/commits/:a/diff/:b/faces', checkToken, checkPermission('cad', 'read'), controller.getFaceDiff);
router.get('/:id/commits/:hash/geometry', checkToken, checkPermission('cad', 'read'), controller.getCommitGeometry);
router.get('/:id/commits/:hash/doc', checkToken, checkPermission('cad', 'read'), controller.getCommitDoc);
router.get('/:id/commits/:hash/thumbnail', checkToken, checkPermission('cad', 'read'), controller.getCommitThumbnail);

// Default camera view — a per-model view preference (not lock-gated).
router.post('/:id/default-view', checkToken, checkPermission('cad', 'write'), controller.setDefaultView);

// Phase 1 — server-side regeneration. Walks the feature tree, hits the
// Postgres-backed BRep cache, falls through to the Rust kernel on miss.
// Returns tessellated face meshes for the viewer to render.
router.post('/:id/regenerate', checkToken, checkPermission('cad', 'read'), controller.regenerate);
router.get('/:id/export/step', checkToken, checkPermission('cad', 'read'), controller.exportStep);

module.exports = router;
