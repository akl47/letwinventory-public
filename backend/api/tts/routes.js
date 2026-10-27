var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../middleware/checkToken.js');
const checkPermission = require('../../middleware/checkPermission');

// EventSource doesn't support custom headers, so accept token via query param
const sseAuth = (req, res, next) => {
    if (!req.headers.authorization && req.query.token) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
};

router.get('/requirement/:id/status', checkToken, checkPermission('requirements', 'read'), controller.requirementStatus);
router.get('/requirement/:id/:field/events', sseAuth, checkToken, checkPermission('requirements', 'read'), controller.requirementFieldEvents);
router.get('/requirement/:id/:field', checkToken, checkPermission('requirements', 'read'), controller.requirementField);
router.get('/owner/:ownerType/:ownerID', checkToken, controller.listForOwner);

module.exports = router;
