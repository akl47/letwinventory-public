'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterBomItem extends Model {
    static associate(models) {
      EngineeringMasterBomItem.belongsTo(models.EngineeringMaster, { as: 'master', foreignKey: 'engineeringMasterID' });
      EngineeringMasterBomItem.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
    }
  }

  EngineeringMasterBomItem.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineeringMasterID: { type: DataTypes.INTEGER, allowNull: false },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
    isTool: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterBomItem',
    timestamps: false,
  });

  return EngineeringMasterBomItem;
};
