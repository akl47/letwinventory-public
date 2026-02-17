const express = require('express');
const router = express.Router();
const taskHistoryController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('tasks', 'read'), taskHistoryController.getAllHistory);
router.get('/actiontypes', checkToken, checkPermission('tasks', 'read'), taskHistoryController.getActionTypes);
router.get('/task/:taskId', checkToken, checkPermission('tasks', 'read'), taskHistoryController.getTaskHistory);

module.exports = router;
