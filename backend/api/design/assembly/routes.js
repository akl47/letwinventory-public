const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// Assemblies reuse the `cad` permission resource. Domain-only routes — all VCS
// operations (checkout/branch/workflow/release/diff) live on the cad-model API.
router.get('/eligible-parts', checkToken, checkPermission('cad', 'read'), controller.listEligibleParts);
router.get('/by-part/:partID/active', checkToken, checkPermission('cad', 'read'), controller.getActiveByPart);
router.post('/by-part/:partID', checkToken, checkPermission('cad', 'write'), controller.createForPart);

router.get('/:id', checkToken, checkPermission('cad', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('cad', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('cad', 'delete'), controller.delete);

// Skeleton content: assembly-level sketches, datum plane features, equations
// (REQ 911/914). Guarded like part-CAD content saves.
router.put('/:id/skeleton', checkToken, checkPermission('cad', 'write'), controller.updateSkeleton);
// Push assembly global variables into child part equations (REQ 918).
router.post('/:id/push-variables', checkToken, checkPermission('cad', 'write'), controller.pushVariables);

// Component instances.
router.post('/:id/instances', checkToken, checkPermission('cad', 'write'), controller.insertInstance);
router.put('/:id/instances/:instanceId', checkToken, checkPermission('cad', 'write'), controller.updateInstance);
router.delete('/:id/instances/:instanceId', checkToken, checkPermission('cad', 'write'), controller.removeInstance);

router.put('/:id/instances/:instanceId/replace', checkToken, checkPermission('cad', 'write'), controller.replaceInstance);

// Mates.
router.post('/:id/mates', checkToken, checkPermission('cad', 'write'), controller.addMate);
router.put('/:id/mates/:mateId', checkToken, checkPermission('cad', 'write'), controller.updateMate);
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

module.exports = router;
