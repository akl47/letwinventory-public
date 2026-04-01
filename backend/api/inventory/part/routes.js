var router = require('express').Router();
var controller = require('./controller');
const fileController = require('../../files/controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/',checkToken,checkPermission('parts','read'),controller.getAllParts);
router.get('/categories',checkToken,checkPermission('parts','read'),controller.getAllPartCategories);
router.get('/search',checkToken,checkPermission('parts','read'),controller.searchPartsByCategory);
router.get('/stock-levels',checkToken,checkPermission('inventory','read'),controller.getStockLevels);
router.get('/revisions/:name',checkToken,checkPermission('parts','read'),controller.getRevisionsByName);
// router.get('/error',checkToken,controller.testError);
router.get('/:id',checkToken,checkPermission('parts','read'),controller.getPartByID);
router.get('/:id/locations',checkToken,checkPermission('inventory','read'),controller.getPartLocations);
router.get('/:id/revision-history',checkToken,checkPermission('parts','read'),controller.getRevisionHistory);
router.post('/',[checkToken,checkPermission('parts','write'),bodyValidator.part],controller.createNewPart);
router.post('/:id/new-revision',checkToken,checkPermission('parts','write'),controller.createNewRevision);
router.post('/:id/release',checkToken,checkPermission('parts','write'),controller.releaseToProduction);
router.put('/:id',[checkToken,checkPermission('parts','write'),bodyValidator.part],controller.updatePartByID);
router.put('/:id/lock',checkToken,checkPermission('parts','write'),controller.lockRevision);
router.put('/:id/unlock',checkToken,checkPermission('parts','write'),controller.unlockRevision);
router.delete('/:id',checkToken,checkPermission('parts','delete'),controller.deletePartByID);
router.post('/upload',checkToken,checkPermission('parts','write'),fileController.uploadFile);
router.delete('/upload/:id',checkToken,checkPermission('parts','write'),fileController.deleteFile);


module.exports = router;