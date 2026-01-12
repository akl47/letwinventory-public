const { Task, User, TaskHistory, TaskList, TaskHistoryActionType } = require('../../../models');
const { Op } = require('sequelize');

// Helper function to get action type ID by code
async function getActionTypeId(code) {
    const actionType = await TaskHistoryActionType.findOne({
        where: { code, activeFlag: true }
    });
    return actionType ? actionType.id : null;
}

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

        const actionId = await getActionTypeId('CREATED');
        if (actionId) {
            await TaskHistory.create({
                taskID: task.id,
                userID: req.user.id,
                actionID: actionId,
                fromID: 0,
                toID: task.taskListID
            });
        }

        res.status(201).json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllTasks = async (req, res) => {
    try {
        const { projectId, taskListId, parentTaskID } = req.query;
        const where = { activeFlag: true };

        if (projectId) {
            where.projectID = projectId;
        }
        if (taskListId) {
            where.taskListID = taskListId;
        }
        if (parentTaskID !== undefined) {
            where.parentTaskID = parentTaskID === 'null' ? null : parentTaskID;
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
            }, {
                model: Task,
                as: 'subtasks',
                attributes: ['id'],
                required: false
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

        // ADD_TO_PROJECT
        if (req.body.projectID !== undefined && req.body.projectID !== oldData.projectID) {
            // Propagate to subtasks
            await Task.update(
                { projectID: req.body.projectID },
                { where: { parentTaskID: task.id } }
            );

            const actionId = await getActionTypeId('ADD_TO_PROJECT');
            if (actionId) {
                await TaskHistory.create({
                    taskID: task.id,
                    userID: req.user.id,
                    actionID: actionId,
                    fromID: oldData.projectID || 0,
                    toID: req.body.projectID || 0
                });
            }
        }

        // ADD_PRIORITY
        if (req.body.taskTypeEnum !== undefined && req.body.taskTypeEnum !== oldData.taskTypeEnum) {
            const priorityMap = { 'normal': 0, 'tracking': 1, 'critical_path': 2 };
            const actionId = await getActionTypeId('ADD_PRIORITY');
            if (actionId) {
                await TaskHistory.create({
                    taskID: task.id,
                    userID: req.user.id,
                    actionID: actionId,
                    fromID: priorityMap[oldData.taskTypeEnum] ?? 0,
                    toID: priorityMap[req.body.taskTypeEnum] ?? 0
                });
            }
        }

        // CHANGE_STATUS
        if (req.body.doneFlag !== undefined && req.body.doneFlag !== oldData.doneFlag) {
            const actionId = await getActionTypeId('CHANGE_STATUS');
            if (actionId) {
                await TaskHistory.create({
                    taskID: task.id,
                    userID: req.user.id,
                    actionID: actionId,
                    fromID: oldData.doneFlag ? 1 : 0,
                    toID: req.body.doneFlag ? 1 : 0
                });
            }

            // Check for parent auto-completion recursively
            if (req.body.doneFlag === true) {
                let currentParentId = task.parentTaskID;

                while (currentParentId) {
                    const parent = await Task.findByPk(currentParentId, {
                        include: [{ model: Task, as: 'subtasks', attributes: ['doneFlag'] }]
                    });

                    if (parent && parent.completeWithChildren) {
                        const allSubtasksDone = parent.subtasks.every(t => t.doneFlag);
                        if (allSubtasksDone && !parent.doneFlag) {
                            await parent.update({ doneFlag: true });
                            if (actionId) {
                                await TaskHistory.create({
                                    taskID: parent.id,
                                    userID: req.user.id,
                                    actionID: actionId,
                                    fromID: 0,
                                    toID: 1
                                });
                            }
                            // Move up
                            currentParentId = parent.parentTaskID;
                        } else {
                            // Parent not ready or already done
                            break;
                        }
                    } else {
                        // Chain broken
                        break;
                    }
                }
            }
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

        // MOVE_LIST
        if (oldListId !== parseInt(taskListId)) {
            const actionId = await getActionTypeId('MOVE_LIST');
            if (actionId) {
                await TaskHistory.create({
                    taskID: taskId,
                    userID: req.user.id,
                    actionID: actionId,
                    fromID: oldListId,
                    toID: parseInt(taskListId)
                });
            }
        }

        res.json(task);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
