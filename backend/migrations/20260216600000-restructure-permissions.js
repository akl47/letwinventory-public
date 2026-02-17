'use strict';

/**
 * Restructure permissions: merge create+update→write, split broad resources
 * into feature-specific ones, remove files resource.
 *
 * Old model: 7 resources (inventory, orders, harness, planning, requirements, files, admin) x 4 CRUD + approve
 * New model: 9 resources (tasks, projects, parts, inventory, equipment, orders, harness, requirements, admin) x 3 (read, write, delete) + approve
 */

// Mapping: old permission → new permissions it grants
const PERMISSION_MAP = {
  'inventory.create':  ['parts.write', 'inventory.write', 'equipment.write'],
  'inventory.read':    ['parts.read', 'inventory.read', 'equipment.read'],
  'inventory.update':  ['parts.write', 'inventory.write', 'equipment.write'],
  'inventory.delete':  ['parts.delete', 'inventory.delete', 'equipment.delete'],
  'planning.create':   ['tasks.write', 'projects.write'],
  'planning.read':     ['tasks.read', 'projects.read'],
  'planning.update':   ['tasks.write', 'projects.write'],
  'planning.delete':   ['tasks.delete', 'projects.delete'],
  'harness.create':    ['harness.write', 'parts.write'],
  'harness.read':      ['harness.read', 'parts.read'],
  'harness.update':    ['harness.write', 'parts.write'],
  'harness.delete':    ['harness.delete', 'parts.delete'],
  'orders.create':     ['orders.write'],
  'orders.update':     ['orders.write'],
  'requirements.create': ['requirements.write'],
  'requirements.update': ['requirements.write'],
  'admin.create':      ['admin.write'],
  'admin.update':      ['admin.write'],
  'files.create':      [],
  'files.read':        [],
  'files.update':      [],
  'files.delete':      [],
};

// These old permissions map 1:1 (same resource.action in new model)
const UNCHANGED = [
  'orders.read', 'orders.delete',
  'harness.read', 'harness.delete',
  'requirements.read', 'requirements.delete', 'requirements.approve',
  'admin.read', 'admin.delete',
];

// All new permissions
const NEW_PERMISSIONS = [
  'tasks.read', 'tasks.write', 'tasks.delete',
  'projects.read', 'projects.write', 'projects.delete',
  'parts.read', 'parts.write', 'parts.delete',
  'inventory.read', 'inventory.write', 'inventory.delete',
  'equipment.read', 'equipment.write', 'equipment.delete',
  'orders.read', 'orders.write', 'orders.delete',
  'harness.read', 'harness.write', 'harness.delete',
  'requirements.read', 'requirements.write', 'requirements.delete', 'requirements.approve',
  'admin.read', 'admin.write', 'admin.delete',
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Insert all new permissions (skip if already exists)
    for (const key of NEW_PERMISSIONS) {
      const [resource, action] = key.split('.');
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = '${resource}' AND action = '${action}'`
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('Permissions', [{ resource, action, createdAt: now }]);
      }
    }

    // 2. Migrate junction table assignments for mapped permissions
    const junctionTables = [
      { table: 'GroupPermissions', fk: 'groupID' },
      { table: 'UserPermissions', fk: 'userID' },
      { table: 'ApiKeyPermissions', fk: 'apiKeyID' },
    ];

    for (const [oldKey, newKeys] of Object.entries(PERMISSION_MAP)) {
      if (newKeys.length === 0) continue; // files.* → removed

      const [oldResource, oldAction] = oldKey.split('.');
      const [oldPerms] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = '${oldResource}' AND action = '${oldAction}'`
      );
      if (oldPerms.length === 0) continue;
      const oldPermId = oldPerms[0].id;

      for (const newKey of newKeys) {
        const [newResource, newAction] = newKey.split('.');
        const [newPerms] = await queryInterface.sequelize.query(
          `SELECT id FROM "Permissions" WHERE resource = '${newResource}' AND action = '${newAction}'`
        );
        if (newPerms.length === 0) continue;
        const newPermId = newPerms[0].id;

        for (const { table, fk } of junctionTables) {
          // Find all rows referencing the old permission
          const [rows] = await queryInterface.sequelize.query(
            `SELECT "${fk}" FROM "${table}" WHERE "permissionID" = ${oldPermId}`
          );
          for (const row of rows) {
            const entityId = row[fk];
            // Insert new mapping (skip duplicates)
            const [existing] = await queryInterface.sequelize.query(
              `SELECT id FROM "${table}" WHERE "${fk}" = ${entityId} AND "permissionID" = ${newPermId}`
            );
            if (existing.length === 0) {
              const insertData = { [fk]: entityId, permissionID: newPermId, createdAt: now };
              await queryInterface.bulkInsert(table, [insertData]);
            }
          }
        }
      }
    }

    // 3. Delete old permissions that don't exist in the new set
    // CASCADE on FKs will clean junction tables automatically
    const oldToDelete = Object.keys(PERMISSION_MAP).filter(k => !NEW_PERMISSIONS.includes(k));
    for (const key of oldToDelete) {
      const [resource, action] = key.split('.');
      await queryInterface.sequelize.query(
        `DELETE FROM "Permissions" WHERE resource = '${resource}' AND action = '${action}'`
      );
    }
  },

  async down(queryInterface) {
    // Reverse is complex — just note that this migration is not easily reversible
    // The seeder will re-create the correct state if needed
    console.log('Down migration for permission restructure is not supported. Re-run seeders to restore.');
  }
};
