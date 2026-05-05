var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../middleware/checkToken.js');
const checkPermission = require('../../middleware/checkPermission');

router.get('/requirement/:id/status', checkToken, checkPermission('requirements', 'read'), controller.requirementStatus);
router.get('/requirement/:id/:field', checkToken, checkPermission('requirements', 'read'), controller.requirementField);
router.get('/owner/:ownerType/:ownerID', checkToken, controller.listForOwner);

module.exports = router;
