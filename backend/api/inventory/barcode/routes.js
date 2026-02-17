var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.post('/print/:id', checkToken, checkPermission('inventory', 'write'), controller.printBarcodeByID);
router.post('/move/:id', checkToken, checkPermission('inventory', 'write'), controller.moveBarcodeByID)
router.get('/', checkToken, checkPermission('inventory', 'read'), controller.getAllBarcodes);
router.get('/locations', checkToken, checkPermission('inventory', 'read'), controller.getLocationBarcodes);
router.get('/lookup/:barcode', checkToken, checkPermission('inventory', 'read'), controller.getBarcodeByString);
router.get('/display/:id', checkToken, checkPermission('inventory', 'read'), controller.displayBarcode);
router.get('/tag/:id', checkToken, checkPermission('inventory', 'read'), controller.getTagByID);
router.get('/tag/chain/:id', checkToken, checkPermission('inventory', 'read'), controller.getTagChainByID);
router.get('/tag/', checkToken, checkPermission('inventory', 'read'), controller.getAllTags);
router.get('/category', checkToken, checkPermission('inventory', 'read'), controller.getBarcodeCategories);
router.delete('/:id', checkToken, checkPermission('inventory', 'delete'), controller.deleteBarcodeByID);

module.exports = router;