'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TaskTimeTracking', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      taskID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Tasks',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      userID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      calendarEventID: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      calendarID: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add index for faster lookups
    await queryInterface.addIndex('TaskTimeTracking', ['taskID']);
    await queryInterface.addIndex('TaskTimeTracking', ['userID']);
    await queryInterface.addIndex('TaskTimeTracking', ['calendarEventID']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('TaskTimeTracking');
  }
};
