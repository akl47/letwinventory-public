const { PushSubscription } = require('../../../models');

exports.subscribe = async (req, res) => {
    try {
        const { endpoint, keys, userAgent } = req.body;
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ error: 'Missing subscription data' });
        }

        const [subscription] = await PushSubscription.upsert({
            userID: req.user.id,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            userAgent: userAgent || null
        });

        res.status(201).json(subscription);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getSubscriptions = async (req, res) => {
    try {
        const subscriptions = await PushSubscription.findAll({
            where: { userID: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json(subscriptions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.unsubscribe = async (req, res) => {
    try {
        const subscription = await PushSubscription.findOne({
            where: { id: req.params.id, userID: req.user.id }
        });
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }
        await subscription.destroy();
        res.json({ message: 'Subscription removed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
