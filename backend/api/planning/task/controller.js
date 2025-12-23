const { Task, User, TaskHistory, TaskList } = require('../../../models');
const { Op } = require('sequelize');

exports.createTask = async (req, res) => {
    try {
        const lastTask = await Task.findOne({
            where: { taskListID: req.body.taskListID },
            order: [['rank', 'DESC']]
        });
        const newRank = lastTask ? lastTask.rank + 1000 : 1000; // Gap for future insertions

        const task = await Task.create({
            ...req.body,
            rank: newRank,
            ownerUserID: req.user.id // Set the owner to the current user
        });

        await TaskHistory.create({
            taskID: task.id,
            userID: req.user.id,
            actionID: 5,
            fromID: 0,
            toID: task.taskListID
        });

        res.status(201).json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllTasks = async (req, res) => {
    try {
        const { projectId, taskListId } = req.query;
        const where = { activeFlag: true };

        if (projectId) {
            where.projectID = projectId;
        }
        if (taskListId) {
            where.taskListID = taskListId;
        }

        const tasks = await Task.findAll({
            where,
            order: [
                ['rank', 'ASC'],
                ['createdAt', 'DESC']
            ],
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'displayName', 'email', 'photoURL']
            }]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getTaskById = async (req, res) => {
    try {
        const task = await Task.findByPk(req.params.id, {
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'displayName', 'email', 'photoURL']
            }]
        });
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        res.json(task);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};



exports.updateTask = async (req, res) => {
    try {
        const task = await Task.findByPk(req.params.id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const oldData = { ...task.get() };
        await task.update(req.body);

        // Tracked Actions:
        // 2: ADD_TO_PROJECT
        if (req.body.projectID !== undefined && req.body.projectID !== oldData.projectID) {
            await TaskHistory.create({
                taskID: task.id,
                userID: req.user.id,
                actionID: 2,
                fromID: oldData.projectID || 0,
                toID: req.body.projectID || 0
            });
        }

        // 3: ADD_PRIORITY
        if (req.body.taskTypeEnum !== undefined && req.body.taskTypeEnum !== oldData.taskTypeEnum) {
            const priorityMap = { 'normal': 0, 'tracking': 1, 'critical_path': 2 };
            await TaskHistory.create({
                taskID: task.id,
                userID: req.user.id,
                actionID: 3,
                fromID: priorityMap[oldData.taskTypeEnum] ?? 0,
                toID: priorityMap[req.body.taskTypeEnum] ?? 0
            });
        }

        // 4: CHANGE_STATUS
        if (req.body.doneFlag !== undefined && req.body.doneFlag !== oldData.doneFlag) {
            await TaskHistory.create({
                taskID: task.id,
                userID: req.user.id,
                actionID: 4,
                fromID: oldData.doneFlag ? 1 : 0,
                toID: req.body.doneFlag ? 1 : 0
            });
        }

        res.json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteTask = async (req, res) => {
    try {
        const task = await Task.findByPk(req.params.id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        await task.update({ activeFlag: false });
        res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.moveTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { taskListId, newIndex } = req.body;

        const task = await Task.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const tasksInList = await Task.findAll({
            where: {
                taskListID: taskListId,
                activeFlag: true,
                id: { [Op.ne]: taskId }
            },
            order: [['rank', 'ASC']]
        });

        let newRank;
        if (tasksInList.length === 0) {
            newRank = 1000;
        } else if (newIndex === 0) {
            newRank = tasksInList[0].rank / 2;
        } else if (newIndex >= tasksInList.length) {
            newRank = tasksInList[tasksInList.length - 1].rank + 1000;
        } else {
            const prevRank = tasksInList[newIndex - 1].rank;
            const nextRank = tasksInList[newIndex].rank;
            newRank = (prevRank + nextRank) / 2;
        }

        const oldListId = task.taskListID;
        await task.update({
            taskListID: taskListId,
            rank: newRank
        });

        // 1: MOVE_LIST
        if (oldListId !== parseInt(taskListId)) {
            await TaskHistory.create({
                taskID: taskId,
                userID: req.user.id,
                actionID: 1,
                fromID: oldListId,
                toID: parseInt(taskListId)
            });
        }

        res.json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
