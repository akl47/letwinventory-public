'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Tasks', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ownerUserID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        }
      },
      projectID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      taskListID: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      doneFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      completeWithChildren: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      dueDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      timeEstimate: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      taskTypeEnum: {
        type: Sequelize.ENUM([
          "normal",
          "tracking",
          "critical_path"
        ]),
        allowNull: false,
        defaultValue: "normal"
      },
      rank: {
        type: Sequelize.DOUBLE,
        allowNull: false,
        defaultValue: 0
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Tasks');
  }
};