const router = require('express').Router();
const controller = require('./controller');

router.get('/', controller.getAllComponents);
router.get('/by-part/:partId', controller.getComponentByPartId);
router.get('/:id', controller.getComponentById);
router.post('/', controller.createComponent);
router.put('/:id', controller.updateComponent);
router.delete('/:id', controller.deleteComponent);

module.exports = router;
