var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('requirements', 'write'), controller.create);
router.get('/', checkToken, checkPermission('requirements', 'read'), controller.getAll);
router.put('/:id', checkToken, checkPermission('requirements', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('requirements', 'delete'), controller.delete);

module.exports = router;
