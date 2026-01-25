'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TaskTimeTracking extends Model {
    static associate(models) {
      TaskTimeTracking.belongsTo(models.Task, {
        foreignKey: 'taskID',
        as: 'task'
      });
      TaskTimeTracking.belongsTo(models.User, {
        foreignKey: 'userID',
        as: 'user'
      });
    }
  }

  TaskTimeTracking.init({
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    taskID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    calendarEventID: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    calendarID: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'TaskTimeTracking',
  });

  return TaskTimeTracking;
};
