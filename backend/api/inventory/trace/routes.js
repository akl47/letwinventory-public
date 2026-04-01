var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/in-progress-builds',checkToken,checkPermission('inventory','read'),controller.getInProgressBuilds);
router.get('/:id',checkToken,checkPermission('inventory','read'),controller.getTraceByID);
router.get('/',checkToken,checkPermission('inventory','read'),controller.getTracesByPartID);
router.post('/',checkToken,checkPermission('inventory','write'),controller.createNewTrace);
router.put('/:id',checkToken,checkPermission('inventory','write'),controller.updateTrace);
router.post('/split/:barcodeId',checkToken,checkPermission('inventory','write'),controller.splitTrace);
router.post('/merge/:barcodeId',checkToken,checkPermission('inventory','write'),controller.mergeTrace);
router.put('/adjust-quantity/:barcodeId',checkToken,checkPermission('inventory','write'),controller.adjustQuantity);
router.post('/kit/:barcodeId',checkToken,checkPermission('inventory','write'),controller.kitTrace);
router.post('/unkit/:barcodeId',checkToken,checkPermission('inventory','write'),controller.unkitTrace);
router.get('/kit-status/:barcodeId',checkToken,checkPermission('inventory','read'),controller.getKitStatus);
router.delete('/barcode/:barcodeId',checkToken,checkPermission('inventory','delete'),controller.deleteTrace);

module.exports = router;