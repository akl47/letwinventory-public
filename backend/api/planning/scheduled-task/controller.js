const { ScheduledTask, TaskList, Project } = require('../../../models');
const cronParser = require('cron-parser');

const includeAssociations = [
    {
        model: TaskList,
        as: 'taskList',
        attributes: ['id', 'name']
    },
    {
        model: Project,
        as: 'project',
        attributes: ['id', 'name', 'shortName', 'tagColorHex']
    }
];

function computeNextRunAt(cronExpression, timezone = 'America/Los_Angeles') {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone });
    return interval.next().toDate();
}

exports.create = async (req, res) => {
    try {
        // Validate cron expression
        let nextRunAt;
        try {
            nextRunAt = computeNextRunAt(req.body.cronExpression, req.body.timezone);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid cron expression: ' + e.message });
        }

        const scheduledTask = await ScheduledTask.create({
            ...req.body,
            ownerUserID: req.user.id,
            nextRunAt
        });

        const result = await ScheduledTask.findByPk(scheduledTask.id, {
            include: includeAssociations
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const where = {};
        if (req.query.includeInactive !== 'true') {
            where.activeFlag = true;
        }

        const scheduledTasks = await ScheduledTask.findAll({
            where,
            include: includeAssociations,
            order: [['createdAt', 'DESC']]
        });

        res.json(scheduledTasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getById = async (req, res) => {
    try {
        const scheduledTask = await ScheduledTask.findByPk(req.params.id, {
            include: includeAssociations
        });
        if (!scheduledTask) {
            return res.status(404).json({ error: 'Scheduled task not found' });
        }
        res.json(scheduledTask);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const scheduledTask = await ScheduledTask.findByPk(req.params.id);
        if (!scheduledTask) {
            return res.status(404).json({ error: 'Scheduled task not found' });
        }

        const updates = { ...req.body };

        const tz = updates.timezone || scheduledTask.timezone || 'America/Los_Angeles';

        // Recompute nextRunAt if cronExpression, timezone, or activeFlag changes
        if ((updates.cronExpression && updates.cronExpression !== scheduledTask.cronExpression) ||
            (updates.timezone && updates.timezone !== scheduledTask.timezone)) {
            try {
                updates.nextRunAt = computeNextRunAt(updates.cronExpression || scheduledTask.cronExpression, tz);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid cron expression: ' + e.message });
            }
        }
        if (updates.activeFlag === true && !scheduledTask.activeFlag) {
            // Reactivating — recompute next run
            try {
                updates.nextRunAt = computeNextRunAt(updates.cronExpression || scheduledTask.cronExpression, tz);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid cron expression: ' + e.message });
            }
        }

        await scheduledTask.update(updates);

        const result = await ScheduledTask.findByPk(scheduledTask.id, {
            include: includeAssociations
        });

        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const scheduledTask = await ScheduledTask.findByPk(req.params.id);
        if (!scheduledTask) {
            return res.status(404).json({ error: 'Scheduled task not found' });
        }

        await scheduledTask.update({ activeFlag: false });
        res.json({ message: 'Scheduled task deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
