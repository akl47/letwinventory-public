const express = require('express');
const router = express.Router();

const authRoutes = require('./auth/auth.routes');
const projectRoutes = require('./project/project.routes');
const taskListRoutes = require('./tasklist/tasklist.routes');
const taskRoutes = require('./task/task.routes');

router.use('/auth', authRoutes);
router.use('/projects', projectRoutes);
router.use('/tasklists', taskListRoutes);
router.use('/tasks', taskRoutes);

module.exports = router;