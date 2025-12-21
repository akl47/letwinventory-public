const { Task, User } = require('../../../models');
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
        await task.update(req.body);
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

        // Logic to calculate new rank
        // This assumes the frontend sends the index where the task was dropped
        // We need to find the tasks bounding the new position
        const tasksInList = await Task.findAll({
            where: {
                taskListID: taskListId,
                activeFlag: true,
                id: { [Op.ne]: taskId } // Exclude current task if same list
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

        await task.update({
            taskListID: taskListId,
            rank: newRank
        });

        res.json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}; 