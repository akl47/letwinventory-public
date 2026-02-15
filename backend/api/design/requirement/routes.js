var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/', checkToken, controller.create);
router.get('/', checkToken, controller.getAll);
router.get('/:id', checkToken, controller.getById);
router.put('/:id', checkToken, controller.update);
router.get('/:id/history', checkToken, controller.getHistory);
router.put('/:id/take-ownership', checkToken, controller.takeOwnership);
router.put('/:id/approve', checkToken, controller.approve);
router.put('/:id/unapprove', checkToken, controller.unapprove);
router.delete('/:id', checkToken, controller.delete);

module.exports = router;
