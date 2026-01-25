const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { verifyToken } = require('../../../auth/passport');

// All routes require authentication
router.use(verifyToken);

// Create a new time tracking record
router.post('/', controller.createTimeTracking);

// Get time tracking records for a specific task
router.get('/task/:taskId', controller.getByTaskId);

// Get time tracking records for the current user
router.get('/user', controller.getByUserId);

// Delete a time tracking record by ID
router.delete('/:id', controller.deleteTimeTracking);

// Delete by calendar event ID
router.delete('/event/:calendarEventId', controller.deleteByCalendarEventId);

module.exports = router;
