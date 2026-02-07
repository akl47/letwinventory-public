'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ScheduledTasks', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      ownerUserID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      taskListID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'TaskLists',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      projectID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Projects',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      taskTypeEnum: {
        type: Sequelize.ENUM('normal', 'tracking', 'critical_path', 'scheduled'),
        allowNull: false,
        defaultValue: 'scheduled'
      },
      timeEstimate: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      dueDateOffsetHours: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      cronExpression: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      timezone: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'America/Los_Angeles'
      },
      nextRunAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      lastRunAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('ScheduledTasks', ['ownerUserID']);
    await queryInterface.addIndex('ScheduledTasks', ['activeFlag', 'nextRunAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ScheduledTasks');
  }
};
