const express = require('express');
const router = express.Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');

router.post('/', checkToken, controller.create);
router.get('/', checkToken, controller.getAll);
router.get('/:id', checkToken, controller.getById);
router.put('/:id', checkToken, controller.update);
router.delete('/:id', checkToken, controller.delete);

module.exports = router;
