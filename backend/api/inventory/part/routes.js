var router = require('express').Router();
var controller = require('./controller');
const fileController = require('../../files/controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/',checkToken,checkPermission('parts','read'),controller.getAllParts);
router.get('/categories',checkToken,checkPermission('parts','read'),controller.getAllPartCategories);
router.get('/search',checkToken,checkPermission('parts','read'),controller.searchPartsByCategory);
// router.get('/error',checkToken,controller.testError);
router.get('/:id',checkToken,checkPermission('parts','read'),controller.getPartByID);
router.post('/',[checkToken,checkPermission('parts','write'),bodyValidator.part],controller.createNewPart);
router.put('/:id',[checkToken,checkPermission('parts','write'),bodyValidator.part],controller.updatePartByID);
router.delete('/:id',checkToken,checkPermission('parts','delete'),controller.deletePartByID);
router.post('/upload',checkToken,checkPermission('parts','write'),fileController.uploadFile);
router.delete('/upload/:id',checkToken,checkPermission('parts','write'),fileController.deleteFile);


module.exports = router;