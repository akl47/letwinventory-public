const { TaskList } = require('../../models/common/tasklist');
const { Op } = require('sequelize');

exports.createTaskList = async (req, res) => {
    try {
        const taskList = await TaskList.create(req.body);
        res.status(201).json(taskList);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllTaskLists = async (req, res) => {
    try {
        const taskLists = await TaskList.findAll({
            where: { activeFlag: true },
            order: [['createdAt', 'ASC']]
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