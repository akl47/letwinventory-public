const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../../../models');
const { loadEffectivePermissions } = require('../../../middleware/checkPermission');

exports.create = async (req, res, next) => {
  try {
    const { name, permissionIds, expiresAt } = req.body;
    if (!name || !name.trim()) {
      return next(new RestError('Name is required', 400));
    }

    const rawKey = 'lwinv_' + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const createData = {
      keyHash,
      name: name.trim(),
      userID: req.user.id
    };
    if (expiresAt) {
      createData.expiresAt = new Date(expiresAt);
    }

    const apiKey = await db.ApiKey.create(createData);

    // Determine which permissions to assign
    const userPerms = await loadEffectivePermissions(req.user.id);
    let assignedPermIds;

    if (Array.isArray(permissionIds)) {
      // Validate all requested IDs are in user's effective set
      const allPerms = await db.Permission.findAll();
      const permMap = new Map(allPerms.map(p => [p.id, `${p.resource}.${p.action}`]));
      for (const pid of permissionIds) {
        const permKey = permMap.get(pid);
        if (!permKey || !userPerms.has(permKey)) {
          return next(new RestError('Requested permissions exceed your effective permissions', 400));
        }
      }
      assignedPermIds = permissionIds;
    } else {
      // Grant all of user's current effective permissions
      const allPerms = await db.Permission.findAll();
      assignedPermIds = allPerms
        .filter(p => userPerms.has(`${p.resource}.${p.action}`))
        .map(p => p.id);
    }

    if (assignedPermIds.length > 0) {
      await db.ApiKeyPermission.bulkCreate(
        assignedPermIds.map(pid => ({ apiKeyID: apiKey.id, permissionID: pid }))
      );
    }

    // Load the assigned permissions for the response
    const keyWithPerms = await db.ApiKey.findByPk(apiKey.id, {
      include: [{
        model: db.Permission,
        as: 'permissions',
        attributes: ['id', 'resource', 'action'],
        through: { attributes: [] }
      }]
    });

    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
      permissions: keyWithPerms.permissions
    });
  } catch (error) {
    next(new RestError('Error creating API key', 500));
  }
};

exports.list = async (req, res, next) => {
  try {
    const keys = await db.ApiKey.findAll({
      where: { userID: req.user.id, activeFlag: true },
      attributes: ['id', 'name', 'lastUsedAt', 'expiresAt', 'createdAt'],
      include: [{
        model: db.Permission,
        as: 'permissions',
        attributes: ['id', 'resource', 'action'],
        through: { attributes: [] }
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(keys);
  } catch (error) {
    next(new RestError('Error listing API keys', 500));
  }
};

exports.revoke = async (req, res, next) => {
  try {
    const apiKey = await db.ApiKey.findOne({
      where: { id: req.params.id, userID: req.user.id, activeFlag: true }
    });
    if (!apiKey) {
      return next(new RestError('API key not found', 404));
    }

    await apiKey.update({ activeFlag: false });
    res.json({ message: 'API key revoked' });
  } catch (error) {
    next(new RestError('Error revoking API key', 500));
  }
};

exports.exchangeToken = async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) {
      return next(new RestError('Key is required', 400));
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    const apiKey = await db.ApiKey.findOne({
      where: { keyHash, activeFlag: true },
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'email', 'displayName', 'photoURL', 'activeFlag']
        },
        {
          model: db.Permission,
          as: 'permissions',
          attributes: ['id', 'resource', 'action'],
          through: { attributes: [] }
        }
      ]
    });

    if (!apiKey) {
      return next(new RestError('Invalid API key', 401));
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return next(new RestError('API key has expired', 401));
    }

    if (!apiKey.user || !apiKey.user.activeFlag) {
      return next(new RestError('User is not active', 401));
    }

    await apiKey.update({ lastUsedAt: new Date() });

    const user = apiKey.user;
    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Intersect key permissions with user's current effective permissions
    const userPerms = await loadEffectivePermissions(user.id);
    const keyPermStrings = new Set(apiKey.permissions.map(p => `${p.resource}.${p.action}`));
    const intersection = [...userPerms].filter(p => keyPermStrings.has(p));

    res.json({
      accessToken,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email
      },
      permissions: intersection
    });
  } catch (error) {
    next(new RestError('Error exchanging API key', 500));
  }
};

exports.getPermissions = async (req, res, next) => {
  try {
    const apiKey = await db.ApiKey.findOne({
      where: { id: req.params.id, userID: req.user.id, activeFlag: true },
      include: [{
        model: db.Permission,
        as: 'permissions',
        attributes: ['id', 'resource', 'action'],
        through: { attributes: [] }
      }]
    });
    if (!apiKey) {
      return next(new RestError('API key not found', 404));
    }
    res.json(apiKey.permissions);
  } catch (error) {
    next(new RestError('Error getting API key permissions', 500));
  }
};
