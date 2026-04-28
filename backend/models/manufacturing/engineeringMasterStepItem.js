'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterStepItem extends Model {
    static associate(models) {
      EngineeringMasterStepItem.belongsTo(models.EngineeringMasterStep, { as: 'step', foreignKey: 'stepID' });
      EngineeringMasterStepItem.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
    }
  }

  EngineeringMasterStepItem.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    stepID: { type: DataTypes.INTEGER, allowNull: false },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
    isTool: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterStepItem',
    timestamps: false,
  });

  return EngineeringMasterStepItem;
};
