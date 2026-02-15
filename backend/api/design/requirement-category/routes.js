var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/', checkToken, controller.create);
router.get('/', checkToken, controller.getAll);
router.put('/:id', checkToken, controller.update);
router.delete('/:id', checkToken, controller.delete);

module.exports = router;
