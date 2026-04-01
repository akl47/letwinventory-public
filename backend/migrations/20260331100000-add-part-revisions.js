'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add revision fields to Parts
    await queryInterface.addColumn('Parts', 'revision', {
      type: Sequelize.STRING(8),
      allowNull: false,
      defaultValue: '00'
    });
    await queryInterface.addColumn('Parts', 'revisionLocked', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn('Parts', 'previousRevisionID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Parts',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // 2. Replace unique index on name with composite (name, revision)
    await queryInterface.sequelize.query('ALTER TABLE "Parts" DROP CONSTRAINT IF EXISTS "Parts_name_key"');
    await queryInterface.sequelize.query('ALTER TABLE "Parts" DROP CONSTRAINT IF EXISTS "Parts_name_key1"');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "parts_name"');
    await queryInterface.addIndex('Parts', ['name', 'revision'], {
      unique: true,
      name: 'parts_name_revision_unique'
    });

    // 3. Create PartRevisionHistory table
    await queryInterface.createTable('PartRevisionHistory', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      changedByUserID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      changeType: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      changes: {
        type: Sequelize.JSON,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // 1. Drop PartRevisionHistory table
    await queryInterface.dropTable('PartRevisionHistory');

    // 2. Restore unique index on name only
    await queryInterface.removeIndex('Parts', 'parts_name_revision_unique');
    await queryInterface.addIndex('Parts', ['name'], {
      unique: true,
      name: 'parts_name'
    });

    // 3. Remove revision fields from Parts
    await queryInterface.removeColumn('Parts', 'previousRevisionID');
    await queryInterface.removeColumn('Parts', 'revisionLocked');
    await queryInterface.removeColumn('Parts', 'revision');
  }
};
