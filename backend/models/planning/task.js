'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Task extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Task.belongsTo(models.User, {
        foreignKey: 'ownerUserID',
        as: 'owner'
      });
      Task.belongsTo(models.Project, {
        foreignKey: 'projectID',
        as: 'project'
      });
      Task.belongsTo(models.TaskList, {
        foreignKey: 'taskListID',
        as: 'taskList'
      });
      Task.belongsTo(models.Task, {
        foreignKey: 'parentTaskID',
        as: 'parent'
      });
      Task.hasMany(models.Task, {
        foreignKey: 'parentTaskID',
        as: 'subtasks'
      });
    }
  };
  Task.init({
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
    projectID: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    taskListID: {
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
    doneFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    completeWithChildren: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    timeEstimate: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    parentTaskID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    taskTypeEnum: {
      type: DataTypes.ENUM('normal', 'tracking', 'critical_path', 'scheduled'),
      allowNull: false,
      defaultValue: 'normal'
    },
    rank: {
      type: DataTypes.STRING, // Using string for Lexorank-like or simple distinct double sorting if needed, but simple float/int works too. Let's use DOUBLE for easier mid-insertion. 
      // Actually, plan said INTEGER. Let's stick to INTEGER for simplicity and re-index on move for now. 
      type: DataTypes.DOUBLE,
      allowNull: false,
      defaultValue: 0
    },
    checklist: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null
    },
    reminderMinutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null
    },
    dueDateNotifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
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
    modelName: 'Task',
  });
  return Task;
};