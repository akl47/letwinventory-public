const { Op } = require('sequelize');
const cronParser = require('cron-parser');
const notificationService = require('./notificationService');

const ONE_MIN_MS = 60 * 1000;

/**
 * Parse cron fields to detect if both DOM and DOW are specified (not wildcards).
 * Standard cron OR's DOM and DOW when both are set. We want AND behavior.
 */
function hasBothDomAndDow(cronExpression) {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const dom = parts[2]; // day of month
    const dow = parts[4]; // day of week
    return dom !== '*' && dow !== '*';
}

/**
 * Check if a value matches a cron field (supports ranges, lists, and single values).
 * e.g. "8-14" matches 8-14, "1,15" matches 1 and 15, "1-7,15-21" matches 1-7 and 15-21.
 */
function matchesCronField(value, field) {
    return field.split(',').some(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            return value >= start && value <= end;
        }
        return value === Number(part);
    });
}

/**
 * Get day-of-month and day-of-week for a Date in a specific timezone.
 * Using getDate()/getDay() would use the server's system timezone, which
 * may differ from the cron timezone.
 */
function getDatePartsInTimezone(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        day: 'numeric'
    }).formatToParts(date);
    const dayOfMonth = Number(parts.find(p => p.type === 'day').value);
    const weekdayStr = parts.find(p => p.type === 'weekday').value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { dayOfMonth, dayOfWeek: dowMap[weekdayStr] };
}

/**
 * Compute the next run date for a cron expression, using AND logic
 * when both day-of-month and day-of-week are specified.
 * cron-parser (and POSIX cron) OR's them by default.
 */
function computeNextRun(cronExpression, timezone = 'America/Los_Angeles') {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone });

    if (!hasBothDomAndDow(cronExpression)) {
        return interval.next().toDate();
    }

    const parts = cronExpression.trim().split(/\s+/);
    const domField = parts[2];
    const dowField = parts[4];

    // Both DOM and DOW set — iterate until we find a date matching both.
    // cron-parser gives us dates matching DOM OR DOW; we filter for AND.
    const MAX_ITERATIONS = 1000;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const candidate = interval.next().toDate();
        const { dayOfMonth, dayOfWeek } = getDatePartsInTimezone(candidate, timezone);
        const domMatch = matchesCronField(dayOfMonth, domField);
        // cron DOW: 0 and 7 = Sunday; JS: 0 = Sunday
        const dowMatch = matchesCronField(dayOfWeek, dowField) ||
            (dayOfWeek === 0 && matchesCronField(7, dowField));
        if (domMatch && dowMatch) {
            return candidate;
        }
    }

    // Fallback — shouldn't happen with reasonable expressions
    throw new Error('Could not find next run date within 1000 iterations');
}

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
                const nextRun = computeNextRun(scheduled.cronExpression, scheduled.timezone);

                await scheduled.update({
                    lastRunAt: new Date(),
                    nextRunAt: nextRun
                });

                notificationService.sendScheduledTaskNotification(scheduled.ownerUserID, scheduled.name, scheduled.notifyOnCreate);
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

module.exports = { initialize, processScheduledTasks, computeNextRun };
