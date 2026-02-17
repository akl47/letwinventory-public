'use strict';

const Resources = {
  tasks: 'tasks',
  projects: 'projects',
  parts: 'parts',
  inventory: 'inventory',
  equipment: 'equipment',
  orders: 'orders',
  harness: 'harness',
  requirements: 'requirements',
  admin: 'admin',
};

const Actions = {
  read: 'read',
  write: 'write',
  delete: 'delete',
};

const extraPermissions = [
  { resource: Resources.requirements, action: 'approve' },
  { resource: Resources.admin, action: 'impersonate' },
];

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();

    // Normalize: lowercase all resource and action values (idempotent)
    await queryInterface.sequelize.query(
      `UPDATE "Permissions" SET resource = LOWER(resource), action = LOWER(action)`
    );
    // Rename legacy 'design' resource to 'requirements' (idempotent)
    await queryInterface.sequelize.query(
      `UPDATE "Permissions" SET resource = '${Resources.requirements}' WHERE resource = 'design'`
    );

    // Seed permissions (skip duplicates)
    for (const resource of Object.values(Resources)) {
      for (const action of Object.values(Actions)) {
        const [existing] = await queryInterface.sequelize.query(
          `SELECT id FROM "Permissions" WHERE resource = '${resource}' AND action = '${action}'`
        );
        if (existing.length === 0) {
          await queryInterface.bulkInsert('Permissions', [{ resource, action, createdAt: now }]);
        }
      }
    }

    // Seed extra permissions (skip duplicates)
    for (const { resource, action } of extraPermissions) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = '${resource}' AND action = '${action}'`
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('Permissions', [{ resource, action, createdAt: now }]);
      }
    }

    // Create Admin group if not exists
    const [existingGroups] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin'`
    );
    let adminGroupId;
    if (existingGroups.length === 0) {
      await queryInterface.bulkInsert('UserGroups', [{
        name: 'Admin',
        description: 'Full access to all resources',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      }]);
      const [groups] = await queryInterface.sequelize.query(
        `SELECT id FROM "UserGroups" WHERE name = 'Admin'`
      );
      adminGroupId = groups[0].id;
    } else {
      adminGroupId = existingGroups[0].id;
    }

    // Create Default group if not exists
    const [existingDefault] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Default'`
    );
    if (existingDefault.length === 0) {
      await queryInterface.bulkInsert('UserGroups', [{
        name: 'Default',
        description: 'Default group for all new users',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      }]);
    }

    // Assign all permissions to Admin group (skip duplicates)
    const [allPerms] = await queryInterface.sequelize.query('SELECT id FROM "Permissions"');
    for (const perm of allPerms) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM "GroupPermissions" WHERE "groupID" = ${adminGroupId} AND "permissionID" = ${perm.id}`
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('GroupPermissions', [{
          groupID: adminGroupId,
          permissionID: perm.id,
          createdAt: now
        }]);
      }
    }
  },

  down: async (queryInterface) => {
    const [groups] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin'`
    );
    if (groups.length > 0) {
      await queryInterface.bulkDelete('GroupPermissions', { groupID: groups[0].id }, {});
      await queryInterface.bulkDelete('UserGroups', { name: 'Admin' }, {});
    }
    await queryInterface.bulkDelete('Permissions', null, {});
  }
};
