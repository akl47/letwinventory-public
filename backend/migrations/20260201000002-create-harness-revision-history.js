'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('HarnessRevisionHistory', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      harnessID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'WireHarnesses',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      revision: {
        type: Sequelize.STRING(10),
        allowNull: false
      },
      releaseState: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      changedBy: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      changeType: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      changeNotes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      snapshotData: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // Add index for querying history by harness
    await queryInterface.addIndex('HarnessRevisionHistory', ['harnessID'], {
      name: 'harness_history_harness_idx'
    });

    // Add index for querying by change type
    await queryInterface.addIndex('HarnessRevisionHistory', ['changeType'], {
      name: 'harness_history_change_type_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('HarnessRevisionHistory');
  }
};
