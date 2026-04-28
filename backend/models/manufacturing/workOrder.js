'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class WorkOrder extends Model {
    static associate(models) {
      WorkOrder.belongsTo(models.EngineeringMaster, { as: 'master', foreignKey: 'engineeringMasterID' });
      WorkOrder.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdByUserID' });
      WorkOrder.belongsTo(models.Barcode, { as: 'locationBarcode', foreignKey: 'locationBarcodeID' });
      WorkOrder.hasMany(models.WorkOrderStepCompletion, { as: 'stepCompletions', foreignKey: 'workOrderID' });
      WorkOrder.hasMany(models.Trace, { as: 'outputTraces', foreignKey: 'workOrderID' });
    }
  }

  WorkOrder.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineeringMasterID: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'not_started' },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdByUserID: { type: DataTypes.INTEGER, allowNull: false },
    locationBarcodeID: { type: DataTypes.INTEGER, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'WorkOrder',
  });

  return WorkOrder;
};
