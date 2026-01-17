const { Task, TaskList } = require('../../../models');
const { Op } = require('sequelize');

exports.createTaskList = async (req, res) => {
    try {
        // Get the max order value and set new list to be at the end
        const maxOrder = await TaskList.max('order', { where: { activeFlag: true } });
        const newOrder = (maxOrder ?? -1) + 1;

        const taskList = await TaskList.create({
            ...req.body,
            order: newOrder
        });
        res.status(201).json(taskList);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllTaskLists = async (req, res) => {
    try {
        const taskLists = await TaskList.findAll({
            where: { activeFlag: true },
            include: [{
                model: Task,
                as: 'tasks',
                where: { activeFlag: true },
                required: false,
                include: [{
                    model: Task,
                    as: 'subtasks',
                    attributes: ['id'],
                    required: false
                }]
            }],
            order: [
                ['order', 'ASC'],
                [{ model: Task, as: 'tasks' }, 'rank', 'ASC'] // Order tasks by rank
            ]
        });
        res.json(taskLists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getTaskListById = async (req, res) => {
    try {
        const taskList = await TaskList.findByPk(req.params.id);
        if (!taskList) {
            return res.status(404).json({ error: 'Task list not found' });
        }
        res.json(taskList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateTaskList = async (req, res) => {
    try {
        const taskList = await TaskList.findByPk(req.params.id);
        if (!taskList) {
            return res.status(404).json({ error: 'Task list not found' });
        }
        await taskList.update(req.body);
        res.json(taskList);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteTaskList = async (req, res) => {
    try {
        const taskList = await TaskList.findByPk(req.params.id);
        if (!taskList) {
            return res.status(404).json({ error: 'Task list not found' });
        }
        await taskList.update({ activeFlag: false });
        res.json({ message: 'Task list deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reorderTaskLists = async (req, res) => {
    try {
        const { orderedIds } = req.body;
        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({ error: 'orderedIds must be an array' });
        }

        // Update each task list's order based on its position in the array
        const updates = orderedIds.map((id, index) =>
            TaskList.update({ order: index }, { where: { id } })
        );

        await Promise.all(updates);
        res.json({ message: 'Task lists reordered successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}; 