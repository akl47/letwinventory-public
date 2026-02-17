const express = require('express');
const router = express.Router();
const taskController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('tasks', 'write'), taskController.createTask);
router.get('/types', checkToken, checkPermission('tasks', 'read'), taskController.getTaskTypes);
router.get('/', checkToken, checkPermission('tasks', 'read'), taskController.getAllTasks);
router.get('/:id', checkToken, checkPermission('tasks', 'read'), taskController.getTaskById);
router.put('/:id', checkToken, checkPermission('tasks', 'write'), taskController.updateTask);
router.delete('/:id', checkToken, checkPermission('tasks', 'delete'), taskController.deleteTask);
router.put('/:taskId/move', checkToken, checkPermission('tasks', 'write'), taskController.moveTask);

module.exports = router; 