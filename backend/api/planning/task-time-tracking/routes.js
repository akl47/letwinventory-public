const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { verifyToken } = require('../../../auth/passport');
const checkPermission = require('../../../middleware/checkPermission');

// All routes require authentication
router.use(verifyToken);

// Create a new time tracking record
router.post('/', checkPermission('tasks', 'write'), controller.createTimeTracking);

// Get time tracking records for a specific task
router.get('/task/:taskId', checkPermission('tasks', 'read'), controller.getByTaskId);

// Get time tracking records for the current user
router.get('/user', checkPermission('tasks', 'read'), controller.getByUserId);

// Delete a time tracking record by ID
router.delete('/:id', checkPermission('tasks', 'delete'), controller.deleteTimeTracking);

// Delete by calendar event ID
router.delete('/event/:calendarEventId', checkPermission('tasks', 'delete'), controller.deleteByCalendarEventId);

module.exports = router;
