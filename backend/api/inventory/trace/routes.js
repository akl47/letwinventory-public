var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const bodyValidator = require('../../../middleware/bodyValidator');

router.get('/:id',checkToken,controller.getTraceByID);
router.get('/',checkToken,controller.getTracesByPartID);
router.post('/',checkToken,controller.createNewTrace);
router.put('/:id',checkToken,controller.updateTrace);

module.exports = router;