'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterStepMarker extends Model {
    static associate(models) {
      EngineeringMasterStepMarker.belongsTo(models.EngineeringMasterStep, { as: 'step', foreignKey: 'stepID' });
    }
  }

  EngineeringMasterStepMarker.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    stepID: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING(50), allowNull: false },
    x: { type: DataTypes.FLOAT, allowNull: false },
    y: { type: DataTypes.FLOAT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterStepMarker',
    timestamps: false,
  });

  return EngineeringMasterStepMarker;
};
