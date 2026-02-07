const { Op } = require('sequelize');
const cronParser = require('cron-parser');

const ONE_MIN_MS = 60 * 1000;

async function processScheduledTasks() {
    const { ScheduledTask, Task } = require('../models');

    try {
        const dueTasks = await ScheduledTask.findAll({
            where: {
                activeFlag: true,
                nextRunAt: { [Op.lte]: new Date() }
            }
        });

        for (const scheduled of dueTasks) {
            try {
                // Calculate rank: last task in list + 1000
                const lastTask = await Task.findOne({
                    where: { taskListID: scheduled.taskListID },
                    order: [['rank', 'DESC']]
                });
                const newRank = lastTask ? lastTask.rank + 1000 : 1000;

                // Compute due date if offset is set
                let dueDate = null;
                if (scheduled.dueDateOffsetHours != null) {
                    dueDate = new Date();
                    dueDate.setTime(dueDate.getTime() + scheduled.dueDateOffsetHours * 60 * 60 * 1000);
                }

                // Create the task
                await Task.create({
                    name: scheduled.name,
                    description: scheduled.description,
                    taskListID: scheduled.taskListID,
                    projectID: scheduled.projectID,
                    taskTypeEnum: scheduled.taskTypeEnum,
                    timeEstimate: scheduled.timeEstimate,
                    ownerUserID: scheduled.ownerUserID,
                    rank: newRank,
                    dueDate,
                    activeFlag: true,
                    doneFlag: false
                });

                // Advance nextRunAt
                const interval = cronParser.parseExpression(scheduled.cronExpression, {
                    tz: scheduled.timezone || 'America/Los_Angeles'
                });
                const nextRun = interval.next().toDate();

                await scheduled.update({
                    lastRunAt: new Date(),
                    nextRunAt: nextRun
                });

                console.log(`[ScheduledTasks] Created task "${scheduled.name}", next run: ${nextRun.toISOString()}`);
            } catch (err) {
                console.error(`[ScheduledTasks] Error processing scheduled task ${scheduled.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[ScheduledTasks] Error querying scheduled tasks:', err.message);
    }
}

function initialize() {
    console.log('[ScheduledTasks] Initializing scheduler (runs every minute)');
    processScheduledTasks();
    setInterval(processScheduledTasks, ONE_MIN_MS);
}

module.exports = { initialize, processScheduledTasks };
