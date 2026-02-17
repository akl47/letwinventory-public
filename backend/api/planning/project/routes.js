const express = require('express');
const router = express.Router();
const projectController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');

router.post('/', checkToken, checkPermission('projects', 'write'), projectController.createProject);
router.get('/', checkToken, checkPermission('projects', 'read'), projectController.getAllProjects);
router.get('/top', checkToken, checkPermission('projects', 'read'), projectController.getTopLevelProjects);
router.get('/:id', checkToken, checkPermission('projects', 'read'), projectController.getProjectById);
router.put('/:id', checkToken, checkPermission('projects', 'write'), projectController.updateProject);
router.delete('/:id', checkToken, checkPermission('projects', 'delete'), projectController.deleteProject);

module.exports = router; 