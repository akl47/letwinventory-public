var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

// Step CRUD
router.post('/', checkToken, checkPermission('manufacturing_planning', 'write'), controller.create);
router.put('/:id', checkToken, checkPermission('manufacturing_planning', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('manufacturing_planning', 'delete'), controller.remove);
router.put('/:id/reorder', checkToken, checkPermission('manufacturing_planning', 'write'), controller.reorder);

// Image upload (base64 JSON body)
router.post('/:masterId/upload-image/:stepId', checkToken, checkPermission('manufacturing_planning', 'write'), controller.uploadImage);
router.delete('/:id/image', checkToken, checkPermission('manufacturing_planning', 'write'), controller.deleteImage);

module.exports = router;
