const { TaskHistory, Task, User, TaskHistoryActionType } = require('../../../models');

exports.getAllHistory = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const history = await TaskHistory.findAll({
            order: [['createdAt', 'DESC']],
            limit: limit,
            offset: offset,
            include: [
                {
                    model: Task,
                    as: 'task',
                    attributes: ['id', 'name']
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'displayName', 'photoURL']
                },
                {
                    model: TaskHistoryActionType,
                    as: 'actionType',
                    attributes: ['id', 'code', 'label']
                }
            ],
            attributes: ['id', 'taskID', 'userID', 'actionID', 'fromID', 'toID', 'createdAt']
        });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getTaskHistory = async (req, res) => {
    try {
        const { taskId } = req.params;
        const history = await TaskHistory.findAll({
            where: { taskID: taskId },
            order: [['createdAt', 'DESC']],
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'displayName', 'photoURL']
                },
                {
                    model: TaskHistoryActionType,
                    as: 'actionType',
                    attributes: ['id', 'code', 'label']
                }
            ]
        });
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getActionTypes = async (req, res) => {
    try {
        const actionTypes = await TaskHistoryActionType.findAll({
            where: { activeFlag: true },
            attributes: ['id', 'code', 'label'],
            order: [['id', 'ASC']]
        });
        res.json(actionTypes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
