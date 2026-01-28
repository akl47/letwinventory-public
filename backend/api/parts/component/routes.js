const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.get('/', checkToken, controller.getAllComponents);
router.get('/by-part/:partId', checkToken, controller.getComponentByPartId);
router.get('/:id', checkToken, controller.getComponentById);
router.post('/', checkToken, controller.createComponent);
router.put('/:id', checkToken, controller.updateComponent);
router.delete('/:id', checkToken, controller.deleteComponent);

module.exports = router;
