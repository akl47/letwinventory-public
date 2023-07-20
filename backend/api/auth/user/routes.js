var router = require('express').Router();
var controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/login', controller.logIn);
router.get('/checkToken',controller.checkToken);
router.get('/',checkToken,controller.getUser);
router.put('/:id',checkToken,controller.updateUser);

module.exports = router;