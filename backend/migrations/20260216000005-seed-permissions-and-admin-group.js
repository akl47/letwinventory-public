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
];

module.exports = {
  async up(queryInterface) {
    // Normalize: lowercase all resource and action values (idempotent)
    await queryInterface.sequelize.query(
      `UPDATE "Permissions" SET resource = LOWER(resource), action = LOWER(action)`
    );
    // Rename legacy 'design' resource to 'requirements' (idempotent)
    await queryInterface.sequelize.query(
      `UPDATE "Permissions" SET resource = '${Resources.requirements}' WHERE resource = 'design'`
    );

    // Seed permissions
    const permRows = [];
    for (const resource of Object.values(Resources)) {
      for (const action of Object.values(Actions)) {
        permRows.push({ resource, action, createdAt: new Date() });
      }
    }
    for (const extra of extraPermissions) {
      permRows.push({ ...extra, createdAt: new Date() });
    }
    await queryInterface.bulkInsert('Permissions', permRows);

    // Create Admin group
    await queryInterface.bulkInsert('UserGroups', [{
      name: 'Admin',
      description: 'Full access',
      activeFlag: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);

    // Query back IDs
    const [perms] = await queryInterface.sequelize.query('SELECT id FROM "Permissions"');
    const [groups] = await queryInterface.sequelize.query('SELECT id FROM "UserGroups" WHERE name = \'Admin\'');
    const adminGroupId = groups[0].id;

    // Assign all permissions to Admin group
    const gpRows = perms.map(p => ({
      groupID: adminGroupId,
      permissionID: p.id,
      createdAt: new Date()
    }));
    await queryInterface.bulkInsert('GroupPermissions', gpRows);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('GroupPermissions', null, {});
    await queryInterface.bulkDelete('UserGroups', { name: 'Admin' }, {});
    await queryInterface.bulkDelete('Permissions', null, {});
  }
};
