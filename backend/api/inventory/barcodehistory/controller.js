const { BarcodeHistory, Barcode, User, BarcodeHistoryActionType, UnitOfMeasure } = require('../../../models');

exports.getAllHistory = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const history = await BarcodeHistory.findAll({
            order: [['createdAt', 'DESC']],
            limit: limit,
            offset: offset,
            include: [
                {
                    model: Barcode,
                    as: 'barcode',
                    attributes: ['id', 'barcode', 'barcodeCategoryID', 'parentBarcodeID']
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'displayName', 'photoURL']
                },
                {
                    model: BarcodeHistoryActionType,
                    as: 'actionType',
                    attributes: ['id', 'code', 'label']
                },
                {
                    model: UnitOfMeasure,
                    as: 'unitOfMeasure',
                    attributes: ['id', 'name', 'description']
                }
            ],
            attributes: ['id', 'barcodeID', 'userID', 'actionID', 'fromID', 'toID', 'qty', 'serialNumber', 'lotNumber', 'unitOfMeasureID', 'createdAt']
        });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getBarcodeHistory = async (req, res) => {
    try {
        const { barcodeId } = req.params;
        const history = await BarcodeHistory.findAll({
            where: { barcodeID: barcodeId },
            order: [['createdAt', 'ASC']],
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'displayName', 'photoURL']
                },
                {
                    model: BarcodeHistoryActionType,
                    as: 'actionType',
                    attributes: ['id', 'code', 'label']
                },
                {
                    model: UnitOfMeasure,
                    as: 'unitOfMeasure',
                    attributes: ['id', 'name', 'description']
                }
            ],
            attributes: ['id', 'barcodeID', 'userID', 'actionID', 'fromID', 'toID', 'qty', 'serialNumber', 'lotNumber', 'unitOfMeasureID', 'createdAt']
        });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getActionTypes = async (req, res) => {
    try {
        const actionTypes = await BarcodeHistoryActionType.findAll({
            where: { activeFlag: true },
            attributes: ['id', 'code', 'label'],
            order: [['id', 'ASC']]
        });
        res.json(actionTypes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
