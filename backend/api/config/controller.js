const { sendPushToUser } = require('../../services/notificationService');

exports.getVapidPublicKey = async (req, res) => {
    try {
        const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
            return res.status(500).json({ error: 'VAPID public key not configured' });
        }
        res.json({ publicKey: vapidPublicKey });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.sendTestNotification = async (req, res) => {
    try {
        const payload = JSON.stringify({
            title: 'Test Notification',
            body: 'Push notifications are working!',
            url: '/settings'
        });
        const result = await sendPushToUser(req.user.id, payload);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
