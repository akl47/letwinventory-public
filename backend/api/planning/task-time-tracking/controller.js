const { TaskTimeTracking, Task, User } = require('../../../models');

/**
 * Create a new task time tracking record
 * Called when the add-on creates a calendar event for a task
 */
exports.createTimeTracking = async (req, res) => {
    try {
        const { taskID, calendarEventID, calendarID } = req.body;

        // Validate required fields
        if (!taskID || !calendarEventID) {
            return res.status(400).json({
                error: 'taskID and calendarEventID are required'
            });
        }

        // Verify the task exists
        const task = await Task.findByPk(taskID);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const timeTracking = await TaskTimeTracking.create({
            taskID,
            userID: req.user.id,
            calendarEventID,
            calendarID: calendarID || null
        });

        res.status(201).json(timeTracking);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

/**
 * Get all time tracking records for a task
 */
exports.getByTaskId = async (req, res) => {
    try {
        const { taskId } = req.params;

        const records = await TaskTimeTracking.findAll({
            where: {
                taskID: taskId,
                activeFlag: true
            },
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'displayName', 'email']
            }],
            order: [['eventStartTime', 'DESC']]
        });

        res.json(records);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get all time tracking records for the current user
 */
exports.getByUserId = async (req, res) => {
    try {
        const records = await TaskTimeTracking.findAll({
            where: {
                userID: req.user.id,
                activeFlag: true
            },
            include: [{
                model: Task,
                as: 'task',
                attributes: ['id', 'name', 'dueDate']
            }],
            order: [['eventStartTime', 'DESC']]
        });

        res.json(records);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Delete a time tracking record (soft delete)
 */
exports.deleteTimeTracking = async (req, res) => {
    try {
        const { id } = req.params;

        const record = await TaskTimeTracking.findByPk(id);
        if (!record) {
            return res.status(404).json({ error: 'Time tracking record not found' });
        }

        // Only allow the owner to delete
        if (record.userID !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to delete this record' });
        }

        await record.update({ activeFlag: false });
        res.json({ message: 'Time tracking record deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Delete by calendar event ID
 * Useful when the calendar event is deleted
 */
exports.deleteByCalendarEventId = async (req, res) => {
    try {
        const { calendarEventId } = req.params;

        const record = await TaskTimeTracking.findOne({
            where: {
                calendarEventID: calendarEventId,
                userID: req.user.id,
                activeFlag: true
            }
        });

        if (!record) {
            return res.status(404).json({ error: 'Time tracking record not found' });
        }

        await record.update({ activeFlag: false });
        res.json({ message: 'Time tracking record deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
