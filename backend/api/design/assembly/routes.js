const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// Assemblies reuse the `cad` permission resource.
router.get('/parts-with-assembly', checkToken, checkPermission('cad', 'read'), controller.listPartsWithAssembly);
router.get('/eligible-parts', checkToken, checkPermission('cad', 'read'), controller.listEligibleParts);
router.get('/by-part/:partID/active', checkToken, checkPermission('cad', 'read'), controller.getActiveByPart);
router.post('/by-part/:partID', checkToken, checkPermission('cad', 'write'), controller.createForPart);

router.get('/:id', checkToken, checkPermission('cad', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('cad', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('cad', 'delete'), controller.delete);

// Component instances.
router.post('/:id/instances', checkToken, checkPermission('cad', 'write'), controller.insertInstance);
router.put('/:id/instances/:instanceId', checkToken, checkPermission('cad', 'write'), controller.updateInstance);
router.delete('/:id/instances/:instanceId', checkToken, checkPermission('cad', 'write'), controller.removeInstance);

router.put('/:id/instances/:instanceId/replace', checkToken, checkPermission('cad', 'write'), controller.replaceInstance);

// Mates.
router.post('/:id/mates', checkToken, checkPermission('cad', 'write'), controller.addMate);
router.delete('/:id/mates/:mateId', checkToken, checkPermission('cad', 'write'), controller.removeMate);

// Component patterns (linear / circular / mirror).
router.post('/:id/patterns', checkToken, checkPermission('cad', 'write'), controller.addPattern);
router.delete('/:id/patterns/:patternId', checkToken, checkPermission('cad', 'write'), controller.removePattern);

// Visualization: exploded views + display states.
router.post('/:id/explode/auto', checkToken, checkPermission('cad', 'write'), controller.autoExplode);
router.put('/:id/explode', checkToken, checkPermission('cad', 'write'), controller.setExplode);
router.post('/:id/display-states', checkToken, checkPermission('cad', 'write'), controller.saveDisplayState);
router.post('/:id/display-states/:stateId/apply', checkToken, checkPermission('cad', 'write'), controller.applyDisplayState);
router.delete('/:id/display-states/:stateId', checkToken, checkPermission('cad', 'write'), controller.deleteDisplayState);

// Composite regenerate + BOM + whole-assembly export.
router.post('/:id/regenerate', checkToken, checkPermission('cad', 'read'), controller.regenerate);
router.get('/:id/bom', checkToken, checkPermission('cad', 'read'), controller.getBom);

// Analysis + documentation: interference, mass properties, BOM sync.
router.post('/:id/interference', checkToken, checkPermission('cad', 'read'), controller.interference);
router.get('/:id/mass-properties', checkToken, checkPermission('cad', 'read'), controller.massProperties);
router.post('/:id/bom/sync', checkToken, checkPermission('cad', 'write'), controller.syncBom);
router.get('/:id/export/step', checkToken, checkPermission('cad', 'read'), controller.exportStep);
router.get('/:id/export/stl', checkToken, checkPermission('cad', 'read'), controller.exportStl);

router.get('/:id/history', checkToken, checkPermission('cad', 'read'), controller.getHistory);

// Version control: checkout (lock), check-in (commit), undo, force-unlock, log.
router.post('/:id/checkout', checkToken, checkPermission('cad', 'write'), controller.checkout);
router.post('/:id/checkin', checkToken, checkPermission('cad', 'write'), controller.checkin);
router.post('/:id/undo-checkout', checkToken, checkPermission('cad', 'write'), controller.undoCheckout);
router.post('/:id/force-unlock', checkToken, checkPermission('cad', 'approve'), controller.forceUnlock);
router.get('/:id/commits', checkToken, checkPermission('cad', 'read'), controller.getCommits);
router.get('/:id/graph', checkToken, checkPermission('cad', 'read'), controller.getGraph);

// Branches (shared vcsBranchOps).
router.get('/:id/branches', checkToken, checkPermission('cad', 'read'), controller.listBranches);
router.post('/:id/branches', checkToken, checkPermission('cad', 'write'), controller.createBranch);
router.post('/:id/switch-branch', checkToken, checkPermission('cad', 'write'), controller.switchBranch);
router.delete('/:id/branches/:name', checkToken, checkPermission('cad', 'write'), controller.archiveBranch);

// Review workflow (shared workflowEngine, per-branch key).
router.get('/:id/workflow', checkToken, checkPermission('cad', 'read'), controller.getWorkflow);
router.post('/:id/workflow', checkToken, checkPermission('cad', 'read'), controller.transitionWorkflow);

// Release a draft branch onto main + frozen released geometry download.
router.post('/:id/release', checkToken, checkPermission('cad', 'write'), controller.release);
router.get('/:id/release/step', checkToken, checkPermission('cad', 'read'), controller.exportReleaseStep);
router.get('/:id/release/stl', checkToken, checkPermission('cad', 'read'), controller.exportReleaseStl);

module.exports = router;
