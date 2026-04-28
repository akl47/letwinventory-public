'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterOutputPart extends Model {
    static associate(models) {
      EngineeringMasterOutputPart.belongsTo(models.EngineeringMaster, { as: 'master', foreignKey: 'engineeringMasterID' });
      EngineeringMasterOutputPart.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
    }
  }

  EngineeringMasterOutputPart.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineeringMasterID: { type: DataTypes.INTEGER, allowNull: false },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterOutputPart',
    timestamps: false,
  });

  return EngineeringMasterOutputPart;
};
