const express = require('express');
const router = express.Router();
const taskController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');
const taskSyncService = require('../../../services/taskSyncService');

// SSE endpoint — must be before /:id so "events" isn't matched as an id
// EventSource doesn't support custom headers, so accept token via query param
const sseAuth = (req, res, next) => {
    if (!req.headers.authorization && req.query.token) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
};
router.get('/events', sseAuth, checkToken, checkPermission('tasks', 'read'), (req, res) => {
    console.log(`[SSE] /events hit: userId=${req.user.id}, tabId=${req.query.tabId}, hasToken=${!!req.query.token}`);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'  // tells nginx/reverse proxies not to buffer
    });
    res.flushHeaders();
    res.write(`event: connected\ndata: {}\n\n`);
    taskSyncService.addClient(req.user.id, res, req.query.tabId || null);
});

router.post('/', checkToken, checkPermission('tasks', 'write'), taskController.createTask);
router.get('/types', checkToken, checkPermission('tasks', 'read'), taskController.getTaskTypes);
router.get('/', checkToken, checkPermission('tasks', 'read'), taskController.getAllTasks);
router.get('/:id', checkToken, checkPermission('tasks', 'read'), taskController.getTaskById);
router.put('/:id', checkToken, checkPermission('tasks', 'write'), taskController.updateTask);
router.delete('/:id', checkToken, checkPermission('tasks', 'delete'), taskController.deleteTask);
router.put('/:taskId/move', checkToken, checkPermission('tasks', 'write'), taskController.moveTask);

module.exports = router; 