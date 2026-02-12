const webpush = require('web-push');
const { Op } = require('sequelize');

const ONE_MIN_MS = 60 * 1000;
let vapidConfigured = false;

function initialize() {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT;

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
        console.log('[Notifications] VAPID keys not configured, push notifications disabled');
        return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
    console.log('[Notifications] Initialized, checking due tasks every minute');

    checkDueTaskReminders();
    setInterval(checkDueTaskReminders, ONE_MIN_MS);
}

async function checkDueTaskReminders() {
    const { Task, PushSubscription } = require('../models');

    try {
        const tasks = await Task.findAll({
            where: {
                doneFlag: false,
                activeFlag: true,
                reminderMinutes: { [Op.not]: null },
                dueDate: { [Op.not]: null },
                dueDateNotifiedAt: null
            }
        });

        const now = new Date();

        for (const task of tasks) {
            const reminderMs = task.reminderMinutes * 60 * 1000;
            const reminderTime = new Date(new Date(task.dueDate).getTime() - reminderMs);

            if (now < reminderTime) continue;

            const hasSubs = await PushSubscription.count({ where: { userID: task.ownerUserID } });
            if (!hasSubs) continue;

            const payload = JSON.stringify({
                title: 'Task Due Reminder',
                body: `"${task.name}" is due soon`,
                url: '/tasks'
            });

            await sendPushToUser(task.ownerUserID, payload);
            await task.update({ dueDateNotifiedAt: now });
        }
    } catch (err) {
        console.error('[Notifications] Error checking due tasks:', err.message);
    }
}

async function sendPushToUser(userID, payload) {
    const { PushSubscription } = require('../models');

    if (!vapidConfigured) {
        return { sent: 0, failed: 0, errors: ['VAPID not configured'] };
    }

    const subscriptions = await PushSubscription.findAll({
        where: { userID }
    });

    if (subscriptions.length === 0) {
        return { sent: 0, failed: 0, errors: ['No subscriptions found'] };
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const sub of subscriptions) {
        try {
            await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
            }, payload);
            sent++;
        } catch (err) {
            failed++;
            if (err.statusCode === 410 || err.statusCode === 404) {
                console.log(`[Notifications] Removing expired subscription ${sub.id}`);
                await sub.destroy();
                errors.push(`Sub ${sub.id}: expired (${err.statusCode}), removed`);
            } else {
                console.error(`[Notifications] Push failed for subscription ${sub.id}:`, err.message);
                errors.push(`Sub ${sub.id}: ${err.statusCode || 'unknown'} - ${err.message}`);
            }
        }
    }

    return { sent, failed, errors };
}

async function sendScheduledTaskNotification(userID, taskName, notifyOnCreate) {
    if (notifyOnCreate === false) return;

    try {
        const payload = JSON.stringify({
            title: 'Scheduled Task Created',
            body: `"${taskName}" was automatically created`,
            url: '/tasks'
        });

        await sendPushToUser(userID, payload);
    } catch (err) {
        console.error('[Notifications] Error sending scheduled task notification:', err.message);
    }
}

module.exports = { initialize, sendScheduledTaskNotification, sendPushToUser };
