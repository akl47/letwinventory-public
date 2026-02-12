'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ScheduledTask extends Model {
    static associate(models) {
      ScheduledTask.belongsTo(models.User, {
        foreignKey: 'ownerUserID',
        as: 'owner'
      });
      ScheduledTask.belongsTo(models.TaskList, {
        foreignKey: 'taskListID',
        as: 'taskList'
      });
      ScheduledTask.belongsTo(models.Project, {
        foreignKey: 'projectID',
        as: 'project'
      });
    }
  };
  ScheduledTask.init({
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    ownerUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    taskListID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    projectID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    taskTypeEnum: {
      type: DataTypes.ENUM('normal', 'tracking', 'critical_path', 'scheduled'),
      allowNull: false,
      defaultValue: 'normal'
    },
    timeEstimate: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    cronExpression: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    timezone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'America/Los_Angeles'
    },
    dueDateOffsetHours: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    nextRunAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    lastRunAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notifyOnCreate: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
    modelName: 'ScheduledTask',
  });
  return ScheduledTask;
};
