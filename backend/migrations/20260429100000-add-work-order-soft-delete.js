'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add audit fields for soft-delete with reason
    await queryInterface.addColumn('WorkOrders', 'deletionReason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('WorkOrders', 'deletedByUserID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' },
    });
    await queryInterface.addColumn('WorkOrders', 'deletedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // Two new permissions for the work-order-specific delete/undelete actions
    const now = new Date();
    await queryInterface.bulkInsert('Permissions', [
      { resource: 'manufacturing_execution', action: 'work_order_delete', createdAt: now },
      { resource: 'manufacturing_execution', action: 'work_order_undelete', createdAt: now },
    ]);

    // Bind the new permissions to the Admin group
    const [adminRows] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`
    );
    if (adminRows.length > 0) {
      const adminGroupId = adminRows[0].id;
      const [permRows] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = 'manufacturing_execution' AND action IN ('work_order_delete', 'work_order_undelete')`
      );
      const groupPerms = permRows.map(p => ({
        groupID: adminGroupId,
        permissionID: p.id,
        createdAt: now,
      }));
      if (groupPerms.length > 0) {
        await queryInterface.bulkInsert('GroupPermissions', groupPerms);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource = 'manufacturing_execution' AND action IN ('work_order_delete', 'work_order_undelete'))`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "Permissions" WHERE resource = 'manufacturing_execution' AND action IN ('work_order_delete', 'work_order_undelete')`
    );
    await queryInterface.removeColumn('WorkOrders', 'deletedAt');
    await queryInterface.removeColumn('WorkOrders', 'deletedByUserID');
    await queryInterface.removeColumn('WorkOrders', 'deletionReason');
  },
};
