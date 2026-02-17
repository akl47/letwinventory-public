'use strict';

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();

    // Insert admin.impersonate permission (skip if exists)
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM "Permissions" WHERE resource = 'admin' AND action = 'impersonate'`
    );
    if (existing.length === 0) {
      await queryInterface.bulkInsert('Permissions', [{ resource: 'admin', action: 'impersonate', createdAt: now }]);
    }

    // Assign to Admin group (skip if exists)
    const [perms] = await queryInterface.sequelize.query(
      `SELECT id FROM "Permissions" WHERE resource = 'admin' AND action = 'impersonate'`
    );
    const [groups] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin'`
    );
    if (perms.length > 0 && groups.length > 0) {
      const [existingGP] = await queryInterface.sequelize.query(
        `SELECT id FROM "GroupPermissions" WHERE "groupID" = ${groups[0].id} AND "permissionID" = ${perms[0].id}`
      );
      if (existingGP.length === 0) {
        await queryInterface.bulkInsert('GroupPermissions', [{
          groupID: groups[0].id,
          permissionID: perms[0].id,
          createdAt: now
        }]);
      }
    }
  },

  down: async (queryInterface) => {
    // CASCADE on GroupPermissions FK will clean up junction rows
    await queryInterface.bulkDelete('Permissions', { resource: 'admin', action: 'impersonate' });
  }
};
