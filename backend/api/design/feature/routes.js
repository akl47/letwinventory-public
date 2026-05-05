var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('features', 'write'), controller.create);
router.get('/', checkToken, checkPermission('features', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('features', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('features', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('features', 'delete'), controller.delete);

router.post('/:id/submit', checkToken, checkPermission('features', 'write'), controller.submit);
router.post('/:id/approve', checkToken, checkPermission('features', 'approve'), controller.approve);
router.post('/:id/reject', checkToken, checkPermission('features', 'write'), controller.reject);
router.post('/:id/release', checkToken, checkPermission('features', 'approve'), controller.release);

router.post('/:id/link-requirement', checkToken, checkPermission('features', 'write'), controller.linkRequirement);
router.delete('/:id/link-requirement/:reqId', checkToken, checkPermission('features', 'write'), controller.unlinkRequirement);

router.post('/:id/sync-github', checkToken, checkPermission('features', 'write'), controller.syncGithub);
router.get('/:id/github/branches', checkToken, checkPermission('features', 'read'), controller.listGithubBranches);
router.get('/:id/github/branch-commits', checkToken, checkPermission('features', 'read'), controller.listGithubBranchCommits);

router.get('/:id/history', checkToken, checkPermission('features', 'read'), controller.getHistory);

module.exports = router;
