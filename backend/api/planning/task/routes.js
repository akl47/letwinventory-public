const express = require('express');
const router = express.Router();
const taskController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");

router.post('/', checkToken, taskController.createTask);
router.get('/', checkToken, taskController.getAllTasks);
router.get('/:id', checkToken, taskController.getTaskById);
router.put('/:id', checkToken, taskController.updateTask);
router.delete('/:id', checkToken, taskController.deleteTask);
router.post('/:taskId/move', checkToken, taskController.moveTask);

module.exports = router; 