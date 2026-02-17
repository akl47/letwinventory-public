const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('parts', 'read'), controller.getAllComponents);
router.get('/by-part/:partId', checkToken, checkPermission('parts', 'read'), controller.getComponentByPartId);
router.get('/:id', checkToken, checkPermission('parts', 'read'), controller.getComponentById);
router.post('/', checkToken, checkPermission('parts', 'write'), controller.createComponent);
router.put('/:id', checkToken, checkPermission('parts', 'write'), controller.updateComponent);
router.delete('/:id', checkToken, checkPermission('parts', 'delete'), controller.deleteComponent);

module.exports = router;
