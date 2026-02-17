'use strict';

/**
 * Creates all permission/group tables and seeds initial data:
 *   - UserGroups, UserGroupMembers
 *   - Permissions, GroupPermissions, UserPermissions
 *   - 29 permissions (9 resources × 3 actions + requirements.approve + admin.impersonate)
 *   - Admin group (all permissions) + Default group (no permissions)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // --- Tables ---

    await queryInterface.createTable('UserGroups', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      activeFlag: { type: Sequelize.BOOLEAN, defaultValue: true, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('UserGroups', ['activeFlag']);

    await queryInterface.createTable('UserGroupMembers', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      groupID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'UserGroups', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('UserGroupMembers', ['userID', 'groupID'], { unique: true });
    await queryInterface.addIndex('UserGroupMembers', ['groupID']);

    await queryInterface.createTable('Permissions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      resource: { type: Sequelize.STRING(50), allowNull: false },
      action: { type: Sequelize.STRING(50), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('Permissions', ['resource', 'action'], { unique: true });

    await queryInterface.createTable('GroupPermissions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      groupID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'UserGroups', key: 'id' }, onDelete: 'CASCADE' },
      permissionID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Permissions', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('GroupPermissions', ['groupID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('GroupPermissions', ['permissionID']);

    await queryInterface.createTable('UserPermissions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      permissionID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Permissions', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('UserPermissions', ['userID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('UserPermissions', ['permissionID']);

    // --- Seed data ---

    const now = new Date();
    const resources = ['tasks', 'projects', 'parts', 'inventory', 'equipment', 'orders', 'harness', 'requirements', 'admin'];
    const actions = ['read', 'write', 'delete'];

    const permRows = [];
    for (const resource of resources) {
      for (const action of actions) {
        permRows.push({ resource, action, createdAt: now });
      }
    }
    permRows.push({ resource: 'requirements', action: 'approve', createdAt: now });
    permRows.push({ resource: 'admin', action: 'impersonate', createdAt: now });
    await queryInterface.bulkInsert('Permissions', permRows);

    // Admin group (all permissions)
    await queryInterface.bulkInsert('UserGroups', [
      { name: 'Admin', description: 'Full access to all resources', activeFlag: true, createdAt: now, updatedAt: now },
      { name: 'Default', description: 'Default group for all new users', activeFlag: true, createdAt: now, updatedAt: now },
    ]);

    const [perms] = await queryInterface.sequelize.query('SELECT id FROM "Permissions"');
    const [groups] = await queryInterface.sequelize.query(`SELECT id FROM "UserGroups" WHERE name = 'Admin'`);
    const adminGroupId = groups[0].id;

    const gpRows = perms.map(p => ({ groupID: adminGroupId, permissionID: p.id, createdAt: now }));
    await queryInterface.bulkInsert('GroupPermissions', gpRows);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserPermissions');
    await queryInterface.dropTable('GroupPermissions');
    await queryInterface.dropTable('UserGroupMembers');
    await queryInterface.dropTable('Permissions');
    await queryInterface.dropTable('UserGroups');
  }
};
