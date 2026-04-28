'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class WorkOrderStepCompletion extends Model {
    static associate(models) {
      WorkOrderStepCompletion.belongsTo(models.WorkOrder, { as: 'workOrder', foreignKey: 'workOrderID' });
      WorkOrderStepCompletion.belongsTo(models.EngineeringMasterStep, { as: 'step', foreignKey: 'stepID' });
      WorkOrderStepCompletion.belongsTo(models.User, { as: 'completedBy', foreignKey: 'completedByUserID' });
    }
  }

  WorkOrderStepCompletion.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workOrderID: { type: DataTypes.INTEGER, allowNull: false },
    stepID: { type: DataTypes.INTEGER, allowNull: false },
    completedByUserID: { type: DataTypes.INTEGER, allowNull: false },
    completedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'WorkOrderStepCompletion',
    timestamps: false,
  });

  return WorkOrderStepCompletion;
};
