'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class QueuedUpdate extends Model {
    static associate(models) {
      
    }
  };
  QueuedUpdate.init({
    queuedUpdateCategory:{
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
  }, {
    sequelize,
    modelName: 'QueuedUpdate',
  });
  return QueuedUpdate;
};