'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('QueuedUpdates', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      queuedUpdateCategory: {
        type: DataTypes.STRING,
        allowNull:false
      },
      completed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      failed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      totalCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue:0
      },
      completedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue:0
      },
      failedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue:0
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE
      }
    });
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('QueuedUpdates');
  }
};