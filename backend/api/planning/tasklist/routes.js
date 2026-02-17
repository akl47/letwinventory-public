const express = require('express');
const router = express.Router();
const taskListController = require('./controller.js');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('tasks', 'write'), taskListController.createTaskList);
router.get('/', checkToken, checkPermission('tasks', 'read'), taskListController.getAllTaskLists);
router.put('/reorder', checkToken, checkPermission('tasks', 'write'), taskListController.reorderTaskLists);
router.get('/:id', checkToken, checkPermission('tasks', 'read'), taskListController.getTaskListById);
router.put('/:id', checkToken, checkPermission('tasks', 'write'), taskListController.updateTaskList);
router.delete('/:id', checkToken, checkPermission('tasks', 'delete'), taskListController.deleteTaskList);

module.exports = router; 