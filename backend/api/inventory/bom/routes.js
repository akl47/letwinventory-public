var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.get('/:partId', checkToken, checkPermission('parts', 'read'), controller.getBom);
router.put('/:partId', checkToken, checkPermission('parts', 'write'), controller.updateBom);

module.exports = router;
