const jwt = require('jsonwebtoken');
const db = require('../../../models');
const { loadEffectivePermissions } = require('../../../middleware/checkPermission');

exports.getAll = async (req, res) => {
  try {
    const users = await db.User.findAll({
      attributes: ['id', 'displayName', 'email', 'photoURL', 'activeFlag'],
      include: [{
        model: db.UserGroup,
        as: 'groups',
        attributes: ['id', 'name'],
        through: { attributes: [] },
        where: { activeFlag: true },
        required: false
      }],
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id, {
      attributes: ['id', 'displayName', 'email', 'photoURL', 'activeFlag'],
      include: [
        {
          model: db.UserGroup,
          as: 'groups',
          attributes: ['id', 'name', 'description'],
          through: { attributes: [] },
          where: { activeFlag: true },
          required: false
        },
        {
          model: db.Permission,
          as: 'directPermissions',
          attributes: ['id', 'resource', 'action', 'description'],
          through: { attributes: [] }
        }
      ]
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setPermissions = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'permissionIds array is required' });
    }

    await db.UserPermission.destroy({ where: { userID: user.id } });
    if (permissionIds.length > 0) {
      const rows = permissionIds.map(pid => ({
        userID: user.id,
        permissionID: pid
      }));
      await db.UserPermission.bulkCreate(rows);
    }

    res.json({ message: 'Permissions updated' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { email, displayName } = req.body;
    if (!email || !displayName) {
      return res.status(400).json({ error: 'email and displayName are required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existing = await db.User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const user = await db.User.create({
      email,
      displayName,
      googleID: `pending-${Date.now()}`,
      photoURL: '',
      activeFlag: true,
    });

    // Auto-add to Default group
    const defaultGroup = await db.UserGroup.findOne({ where: { name: 'Default', activeFlag: true } });
    if (defaultGroup) {
      await db.UserGroupMember.findOrCreate({ where: { userID: user.id, groupID: defaultGroup.id } });
    }

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await user.update({ activeFlag: false });
    res.json({ message: 'User deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.activate = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await user.update({ activeFlag: true });
    res.json({ message: 'User activated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.impersonate = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }

    const target = await db.User.findByPk(targetId);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!target.activeFlag) {
      return res.status(400).json({ error: 'Cannot impersonate an inactive user' });
    }

    const token = jwt.sign(
      {
        id: target.id,
        email: target.email,
        displayName: target.displayName,
        photoURL: target.photoURL,
        impersonatedBy: req.user.id
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const permissions = await loadEffectivePermissions(target.id);

    res.json({
      token,
      user: { id: target.id, displayName: target.displayName, email: target.email },
      permissions: [...permissions]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
