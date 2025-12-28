var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');


router.get('/',checkToken,controller.getAllParts);
// router.get('/error',checkToken,controller.testError);
// router.get('/:id',checkToken,controller.getPartByID);
router.post('/',[checkToken,bodyValidator.part],controller.createNewPart);
router.put('/:id',[checkToken,bodyValidator.part],controller.updatePartByID);
router.delete('/:id',checkToken,controller.deletePartByID);


module.exports = router;