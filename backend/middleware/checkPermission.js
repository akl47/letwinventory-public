const db = require('../models');

async function loadEffectivePermissions(userId) {
  // Get user's active group IDs
  const memberships = await db.UserGroupMember.findAll({
    where: { userID: userId },
    include: [{ model: db.UserGroup, as: 'group', where: { activeFlag: true }, attributes: ['id'], required: true }]
  });
  const groupIds = memberships.map(m => m.groupID);

  // Get group permissions
  const groupPerms = groupIds.length > 0
    ? await db.GroupPermission.findAll({
        where: { groupID: groupIds },
        include: [{ model: db.Permission, as: 'permission', attributes: ['resource', 'action'] }]
      })
    : [];

  // Get direct user permissions
  const directPerms = await db.UserPermission.findAll({
    where: { userID: userId },
    include: [{ model: db.Permission, as: 'permission', attributes: ['resource', 'action'] }]
  });

  // Build union set
  const permSet = new Set();
  for (const gp of groupPerms) {
    permSet.add(`${gp.permission.resource}.${gp.permission.action}`);
  }
  for (const dp of directPerms) {
    permSet.add(`${dp.permission.resource}.${dp.permission.action}`);
  }
  return permSet;
}

function checkPermission(resource, action) {
  return async (req, res, next) => {
    try {
      if (!req._effectivePermissions) {
        req._effectivePermissions = await loadEffectivePermissions(req.user.id);
      }

      if (req._effectivePermissions.has(`${resource}.${action}`)) {
        return next();
      }

      next(new RestError('Insufficient permissions', 403));
    } catch (error) {
      next(new RestError('Permission check failed', 500));
    }
  };
}

module.exports = checkPermission;
module.exports.loadEffectivePermissions = loadEffectivePermissions;
