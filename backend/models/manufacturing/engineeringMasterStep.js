'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterStep extends Model {
    static associate(models) {
      EngineeringMasterStep.belongsTo(models.EngineeringMaster, { as: 'master', foreignKey: 'engineeringMasterID' });
      EngineeringMasterStep.belongsTo(models.UploadedFile, { as: 'imageFile', foreignKey: 'imageFileID' });
      EngineeringMasterStep.hasMany(models.EngineeringMasterStepItem, { as: 'items', foreignKey: 'stepID' });
      EngineeringMasterStep.hasMany(models.EngineeringMasterStepMarker, { as: 'markers', foreignKey: 'stepID' });
    }
  }

  EngineeringMasterStep.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineeringMasterID: { type: DataTypes.INTEGER, allowNull: false },
    stepNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
    title: { type: DataTypes.STRING(255), allowNull: false },
    instructions: { type: DataTypes.TEXT, allowNull: true },
    imageFileID: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterStep',
  });

  return EngineeringMasterStep;
};
