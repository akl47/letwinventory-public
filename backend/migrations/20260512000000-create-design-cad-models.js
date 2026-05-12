'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DesignCADModels', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: true },
      partID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Parts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      revision: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'A' },
      previousRevisionID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'DesignCADModels', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      featureTree: { type: Sequelize.JSONB, allowNull: false },
      sketchDoc: { type: Sequelize.JSONB, allowNull: false },
      releaseState: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
      submittedAt: { type: Sequelize.DATE, allowNull: true },
      releasedAt: { type: Sequelize.DATE, allowNull: true },
      releasedByUserID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      createdByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    await queryInterface.addIndex('DesignCADModels', ['partID']);
    await queryInterface.addIndex(
      'DesignCADModels',
      ['partID', 'revision'],
      { unique: true, where: { activeFlag: true }, name: 'design_cad_models_part_revision_unique_active' }
    );

    await queryInterface.createTable('DesignCADModelHistory', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      cadModelID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'DesignCADModels', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      changeType: { type: Sequelize.STRING(30), allowNull: false },
      changedByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      previousState: { type: Sequelize.JSONB, allowNull: true },
      newState: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('DesignCADModelHistory', ['cadModelID']);

    // Seed 'cad' permission resource (read/write/delete) + cad.approve.
    const permNow = new Date();
    await queryInterface.bulkInsert('Permissions', [
      { resource: 'cad', action: 'read', createdAt: permNow },
      { resource: 'cad', action: 'write', createdAt: permNow },
      { resource: 'cad', action: 'delete', createdAt: permNow },
      { resource: 'cad', action: 'approve', createdAt: permNow },
    ]);

    const [adminGroup] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`
    );
    if (adminGroup.length > 0) {
      const adminGroupId = adminGroup[0].id;
      const [perms] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = 'cad'`
      );
      const gpRows = perms.map(p => ({
        groupID: adminGroupId,
        permissionID: p.id,
        createdAt: permNow,
      }));
      if (gpRows.length > 0) {
        await queryInterface.bulkInsert('GroupPermissions', gpRows);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('DesignCADModelHistory');
    await queryInterface.dropTable('DesignCADModels');
    await queryInterface.sequelize.query(
      `DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource = 'cad')`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "Permissions" WHERE resource = 'cad'`
    );
  },
};
