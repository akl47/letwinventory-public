const express = require('express');
const router = express.Router();
const controller = require('./controller');
const checkToken = require('../../../middleware/checkToken.js');
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('tasks', 'write'), controller.create);
router.get('/', checkToken, checkPermission('tasks', 'read'), controller.getAll);
router.get('/:id', checkToken, checkPermission('tasks', 'read'), controller.getById);
router.put('/:id', checkToken, checkPermission('tasks', 'write'), controller.update);
router.delete('/:id', checkToken, checkPermission('tasks', 'delete'), controller.delete);

module.exports = router;
