'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = Sequelize.literal('NOW()');

    // EngineeringMasters
    await queryInterface.createTable('EngineeringMasters', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      revision: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'A' },
      releaseState: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
      previousRevisionID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      createdByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      releasedByUserID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      releasedAt: { type: Sequelize.DATE, allowNull: true },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasters', ['name', 'revision'], { unique: true });
    await queryInterface.addIndex('EngineeringMasters', ['activeFlag']);
    await queryInterface.addIndex('EngineeringMasters', ['releaseState']);

    // EngineeringMasterOutputParts
    await queryInterface.createTable('EngineeringMasterOutputParts', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      engineeringMasterID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      partID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Parts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      quantity: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasterOutputParts', ['engineeringMasterID', 'partID'], { unique: true });

    // EngineeringMasterSteps
    await queryInterface.createTable('EngineeringMasterSteps', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      engineeringMasterID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      stepNumber: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      title: { type: Sequelize.STRING(255), allowNull: false },
      instructions: { type: Sequelize.TEXT, allowNull: true },
      imageFileID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'UploadedFiles', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasterSteps', ['engineeringMasterID', 'stepNumber'], { unique: true });

    // EngineeringMasterStepItems
    await queryInterface.createTable('EngineeringMasterStepItems', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      stepID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasterSteps', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      partID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Parts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      quantity: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
      isTool: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasterStepItems', ['stepID', 'partID'], { unique: true });

    // EngineeringMasterStepMarkers
    await queryInterface.createTable('EngineeringMasterStepMarkers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      stepID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasterSteps', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      label: { type: Sequelize.STRING(50), allowNull: false },
      x: { type: Sequelize.FLOAT, allowNull: false },
      y: { type: Sequelize.FLOAT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });

    // EngineeringMasterHistory
    await queryInterface.createTable('EngineeringMasterHistory', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      engineeringMasterID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      changeType: { type: Sequelize.STRING(30), allowNull: false },
      changes: { type: Sequelize.JSON, allowNull: true },
      snapshotData: { type: Sequelize.JSON, allowNull: true },
      changedByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasterHistory', ['engineeringMasterID']);

    // WorkOrders
    await queryInterface.createTable('WorkOrders', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      engineeringMasterID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'not_started' },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      createdByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('WorkOrders', ['status']);
    await queryInterface.addIndex('WorkOrders', ['engineeringMasterID']);
    await queryInterface.addIndex('WorkOrders', ['activeFlag']);

    // WorkOrderStepCompletions
    await queryInterface.createTable('WorkOrderStepCompletions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      workOrderID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'WorkOrders', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      stepID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasterSteps', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      completedByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      completedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('WorkOrderStepCompletions', ['workOrderID', 'stepID'], { unique: true });

    // Seed manufacturing permissions
    const permNow = new Date();
    const newPerms = [
      { resource: 'manufacturing_planning', action: 'read', createdAt: permNow },
      { resource: 'manufacturing_planning', action: 'write', createdAt: permNow },
      { resource: 'manufacturing_planning', action: 'delete', createdAt: permNow },
      { resource: 'manufacturing_execution', action: 'read', createdAt: permNow },
      { resource: 'manufacturing_execution', action: 'write', createdAt: permNow },
      { resource: 'manufacturing_execution', action: 'delete', createdAt: permNow },
    ];
    await queryInterface.bulkInsert('Permissions', newPerms);

    // Add new permissions to Admin group
    const [adminGroup] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`
    );
    if (adminGroup.length > 0) {
      const adminGroupId = adminGroup[0].id;
      const [perms] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource IN ('manufacturing_planning', 'manufacturing_execution')`
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
    await queryInterface.dropTable('WorkOrderStepCompletions');
    await queryInterface.dropTable('WorkOrders');
    await queryInterface.dropTable('EngineeringMasterHistory');
    await queryInterface.dropTable('EngineeringMasterStepMarkers');
    await queryInterface.dropTable('EngineeringMasterStepItems');
    await queryInterface.dropTable('EngineeringMasterSteps');
    await queryInterface.dropTable('EngineeringMasterOutputParts');
    await queryInterface.dropTable('EngineeringMasters');

    await queryInterface.sequelize.query(
      `DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource IN ('manufacturing_planning', 'manufacturing_execution'))`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "Permissions" WHERE resource IN ('manufacturing_planning', 'manufacturing_execution')`
    );
  },
};
