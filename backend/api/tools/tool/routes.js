const router = require('express').Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('tools', 'read'), controller.list);
router.get('/by-part/:partID', checkToken, checkPermission('tools', 'read'), controller.getByPart);
router.get('/:id', checkToken, checkPermission('tools', 'read'), controller.getById);

router.post('/', checkToken, checkPermission('parts', 'write'), controller.create);
router.put('/:id', checkToken, checkPermission('parts', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('parts', 'delete'), controller.remove);

module.exports = router;
