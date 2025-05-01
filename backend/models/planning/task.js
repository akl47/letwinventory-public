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
      allowNull: false,
      defaultValue: 1
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
    taskTypeEnum: {
      type: DataTypes.ENUM('normal', 'tracking', 'critical_path'),
      allowNull: false,
      defaultValue: 'normal'
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