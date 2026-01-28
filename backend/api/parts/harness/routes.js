var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllHarnesses);
router.get('/next-part-number', checkToken, controller.getNextPartNumber);
router.get('/:id', checkToken, controller.getHarnessById);
router.post('/', checkToken, controller.createHarness);
router.post('/validate', checkToken, controller.validateHarness);
router.put('/:id', checkToken, controller.updateHarness);
router.delete('/:id', checkToken, controller.deleteHarness);

module.exports = router;
