const {Project, User} = require('../../../models');
const { Op } = require('sequelize');

exports.createProject = async (req, res) => {
    try {
        const project = await Project.create({
            ...req.body,
            ownerUserID: req.user.id
        });
        res.status(201).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllProjects = async (req, res) => {
    try {
        const projects = await Project.findAll({
            where: { activeFlag: true },
            order: [['createdAt', 'DESC']],
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'displayName', 'email', 'photoURL']
            }]
        });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getTopLevelProjects = async (req, res) => {
    try {
        const projects = await Project.findAll({
            where: { activeFlag: true, parentProjectID: null },
            order: [['createdAt', 'DESC']],
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'displayName', 'email', 'photoURL']
            }]
        });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getProjectById = async (req, res) => {
    try {
        const project = await Project.findByPk(req.params.id, {
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'displayName', 'email', 'photoURL']
            }]
        });
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateProject = async (req, res) => {
    try {
        const project = await Project.findByPk(req.params.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        await project.update(req.body);
        res.json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteProject = async (req, res) => {
    try {
        const project = await Project.findByPk(req.params.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        await project.update({ activeFlag: false });
        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}; 