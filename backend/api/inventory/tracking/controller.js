const db = require('../../../models');
const createError = require('http-errors');
const { detectCarrier, refreshTracking } = require('../../../services/trackingService');

exports.getAllTrackings = (req, res, next) => {
    const where = { ownerUserID: req.user.id };
    if (req.query.includeInactive !== 'true') {
        where.activeFlag = true;
    }

    db.ShipmentTracking.findAll({
        where,
        order: [['updatedAt', 'DESC']],
        include: [{
            model: db.Order,
            attributes: ['id', 'vendor', 'description']
        }]
    }).then(trackings => {
        res.json(trackings);
    }).catch(error => {
        next(createError(500, 'Error getting trackings: ' + error));
    });
};

exports.getTrackingById = (req, res, next) => {
    db.ShipmentTracking.findOne({
        where: { id: req.params.id, ownerUserID: req.user.id },
        include: [{
            model: db.Order,
            attributes: ['id', 'vendor', 'description']
        }]
    }).then(tracking => {
        if (!tracking) return next(createError(404, 'Tracking not found'));
        res.json(tracking);
    }).catch(error => {
        next(createError(500, 'Error getting tracking: ' + error));
    });
};

exports.createTracking = async (req, res, next) => {
    try {
        const { trackingNumber, orderID } = req.body;
        if (!trackingNumber) {
            return next(createError(400, 'Tracking number is required'));
        }

        const carrier = detectCarrier(trackingNumber);

        const tracking = await db.ShipmentTracking.create({
            trackingNumber: trackingNumber.trim(),
            carrier,
            orderID: orderID || null,
            ownerUserID: req.user.id
        });

        // Try to fetch initial status
        try {
            await refreshTracking(tracking);
        } catch (err) {
            // Non-fatal: tracking was created, status fetch failed
            console.error('[Tracking] Initial fetch failed:', err.message);
        }

        // Reload with associations
        const result = await db.ShipmentTracking.findByPk(tracking.id, {
            include: [{
                model: db.Order,
                attributes: ['id', 'vendor', 'description']
            }]
        });

        res.json(result);
    } catch (error) {
        next(createError(500, 'Error creating tracking: ' + error));
    }
};

exports.updateTracking = (req, res, next) => {
    db.ShipmentTracking.findOne({
        where: { id: req.params.id, ownerUserID: req.user.id }
    }).then(tracking => {
        if (!tracking) return next(createError(404, 'Tracking not found'));

        const updates = {};
        if (req.body.trackingNumber !== undefined) {
            updates.trackingNumber = req.body.trackingNumber.trim();
            updates.carrier = detectCarrier(req.body.trackingNumber);
        }
        if (req.body.orderID !== undefined) updates.orderID = req.body.orderID;
        if (req.body.activeFlag !== undefined) updates.activeFlag = req.body.activeFlag;

        return tracking.update(updates);
    }).then(updated => {
        res.json(updated);
    }).catch(error => {
        next(createError(500, 'Error updating tracking: ' + error));
    });
};

exports.deleteTracking = (req, res, next) => {
    db.ShipmentTracking.findOne({
        where: { id: req.params.id, ownerUserID: req.user.id, activeFlag: true }
    }).then(tracking => {
        if (!tracking) return next(createError(404, 'Tracking not found'));
        return tracking.update({ activeFlag: false });
    }).then(deleted => {
        res.json(deleted);
    }).catch(error => {
        next(createError(500, 'Error deleting tracking: ' + error));
    });
};

exports.refreshTracking = async (req, res, next) => {
    try {
        const tracking = await db.ShipmentTracking.findOne({
            where: { id: req.params.id, ownerUserID: req.user.id }
        });
        if (!tracking) return next(createError(404, 'Tracking not found'));

        await refreshTracking(tracking);

        // Reload with associations
        const result = await db.ShipmentTracking.findByPk(tracking.id, {
            include: [{
                model: db.Order,
                attributes: ['id', 'vendor', 'description']
            }]
        });

        res.json(result);
    } catch (error) {
        next(createError(500, 'Error refreshing tracking: ' + error));
    }
};
