const express = require('express');
const router = express.Router();
const projectController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");

router.post('/', checkToken, projectController.createProject);
router.get('/', checkToken, projectController.getAllProjects);
router.get('/top', checkToken, projectController.getTopLevelProjects);
router.get('/:id', checkToken, projectController.getProjectById);
router.put('/:id', checkToken, projectController.updateProject);
router.delete('/:id', checkToken, projectController.deleteProject);

module.exports = router; 