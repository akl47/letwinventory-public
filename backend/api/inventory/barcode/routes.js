var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/print/', controller.printBarcode); //Needs Check Token
router.post('/move/:id', controller.moveBarcodeByID) //Needs Check Token
router.get('/', controller.getAllBarcodes); //Needs Check Token
router.get('/display/:id', controller.displayBarcode); //Needs Check Token
router.get('/tag/:id', controller.getTagByID); //Needs Check Token
router.get('/tag/chain/:id', controller.getTagChainByID); //Needs Check Token
router.get('/tag/', controller.getAllTags); //Needs Check Token
router.get('/category', controller.getBarcodeCategories); //Needs Check Token
router.delete('/:id', controller.deleteBarcodeByID); //Needs Check Token

module.exports = router;