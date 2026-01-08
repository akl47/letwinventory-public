var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/print/', checkToken, controller.printBarcode); //Needs Check Token
router.post('/print/:id', checkToken, controller.printBarcodeByID); //Needs Check Token
router.post('/move/:id', checkToken, controller.moveBarcodeByID) //Needs Check Token
router.get('/', checkToken, controller.getAllBarcodes); //Needs Check Token
router.get('/display/:id', checkToken, controller.displayBarcode); //Needs Check Token
router.get('/tag/:id', checkToken, controller.getTagByID); //Needs Check Token
router.get('/tag/chain/:id', checkToken, controller.getTagChainByID); //Needs Check Token
router.get('/tag/', checkToken, controller.getAllTags); //Needs Check Token
router.get('/category', checkToken, controller.getBarcodeCategories); //Needs Check Token
router.delete('/:id', checkToken, controller.deleteBarcodeByID); //Needs Check Token

module.exports = router;