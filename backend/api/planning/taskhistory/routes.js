const express = require('express');
const router = express.Router();
const taskHistoryController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");

router.get('/', checkToken, taskHistoryController.getAllHistory);
router.get('/task/:taskId', checkToken, taskHistoryController.getTaskHistory);

module.exports = router;
