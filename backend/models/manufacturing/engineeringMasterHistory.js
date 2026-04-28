'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMasterHistory extends Model {
    static associate(models) {
      EngineeringMasterHistory.belongsTo(models.EngineeringMaster, { as: 'master', foreignKey: 'engineeringMasterID' });
      EngineeringMasterHistory.belongsTo(models.User, { as: 'changedBy', foreignKey: 'changedByUserID' });
    }
  }

  EngineeringMasterHistory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineeringMasterID: { type: DataTypes.INTEGER, allowNull: false },
    changeType: { type: DataTypes.STRING(30), allowNull: false },
    changes: { type: DataTypes.JSON, allowNull: true },
    snapshotData: { type: DataTypes.JSON, allowNull: true },
    changedByUserID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMasterHistory',
    freezeTableName: true,
    timestamps: false,
  });

  return EngineeringMasterHistory;
};
