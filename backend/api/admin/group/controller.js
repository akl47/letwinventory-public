const db = require('../../../models');

exports.getAll = async (req, res) => {
  try {
    const groups = await db.UserGroup.findAll({
      where: { activeFlag: true },
      include: [{
        model: db.User,
        as: 'members',
        attributes: ['id'],
        through: { attributes: [] }
      }],
      order: [['name', 'ASC']]
    });
    const result = groups.map(g => {
      const plain = g.toJSON();
      plain.memberCount = plain.members.length;
      delete plain.members;
      return plain;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const group = await db.UserGroup.findByPk(req.params.id, {
      include: [
        {
          model: db.User,
          as: 'members',
          attributes: ['id', 'displayName', 'email'],
          through: { attributes: [] }
        },
        {
          model: db.Permission,
          as: 'permissions',
          attributes: ['id', 'resource', 'action', 'description'],
          through: { attributes: [] }
        }
      ]
    });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    if (!req.body.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const group = await db.UserGroup.create({
      name: req.body.name,
      description: req.body.description || null
    });
    res.status(201).json(group);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const group = await db.UserGroup.findByPk(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (Object.keys(updates).length > 0) {
      await group.update(updates);
    }

    // Update permissions if provided
    if (Array.isArray(req.body.permissionIds)) {
      await db.GroupPermission.destroy({ where: { groupID: group.id } });
      if (req.body.permissionIds.length > 0) {
        const rows = req.body.permissionIds.map(pid => ({
          groupID: group.id,
          permissionID: pid
        }));
        await db.GroupPermission.bulkCreate(rows);
      }
    }

    res.json(group);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const group = await db.UserGroup.findByPk(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    await group.update({ activeFlag: false });
    res.json({ message: 'Group deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.addMember = async (req, res) => {
  try {
    const group = await db.UserGroup.findByPk(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!req.body.userID) {
      return res.status(400).json({ error: 'userID is required' });
    }
    const existing = await db.UserGroupMember.findOne({
      where: { userID: req.body.userID, groupID: group.id }
    });
    if (existing) {
      return res.status(400).json({ error: 'User is already a member of this group' });
    }
    await db.UserGroupMember.create({ userID: req.body.userID, groupID: group.id });
    res.status(201).json({ message: 'Member added' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const member = await db.UserGroupMember.findOne({
      where: { groupID: req.params.id, userID: req.params.userId }
    });
    if (!member) {
      return res.status(404).json({ error: 'Membership not found' });
    }
    await member.destroy();
    res.json({ message: 'Member removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
