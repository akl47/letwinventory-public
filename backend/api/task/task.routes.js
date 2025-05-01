const express = require('express');
const router = express.Router();
const taskController = require('./task.controller');

router.post('/', taskController.createTask);
router.get('/', taskController.getAllTasks);
router.get('/:id', taskController.getTaskById);
router.put('/:id', taskController.updateTask);
router.delete('/:id', taskController.deleteTask);
router.post('/:taskId/move', taskController.moveTask);

module.exports = router; 