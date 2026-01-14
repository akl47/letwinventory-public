var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/:id',checkToken,controller.getTraceByID);
router.get('/',checkToken,controller.getTracesByPartID);
router.post('/',checkToken,controller.createNewTrace);
router.put('/:id',checkToken,controller.updateTrace);
router.post('/split/:barcodeId',checkToken,controller.splitTrace);
router.post('/merge/:barcodeId',checkToken,controller.mergeTrace);
router.delete('/barcode/:barcodeId',checkToken,controller.deleteTrace);

module.exports = router;