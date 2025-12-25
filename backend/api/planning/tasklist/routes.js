const express = require('express');
const router = express.Router();
const taskListController = require('./controller.js');
const checkToken = require("../../../middleware/checkToken.js");

router.post('/', checkToken, taskListController.createTaskList);
router.get('/', checkToken, taskListController.getAllTaskLists);
router.get('/:id', checkToken, taskListController.getTaskListById);
router.put('/:id', checkToken, taskListController.updateTaskList);
router.delete('/:id', checkToken, taskListController.deleteTaskList);

module.exports = router; 