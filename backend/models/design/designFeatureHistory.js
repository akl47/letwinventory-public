'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignFeatureHistory extends Model {
    static associate(models) {
      DesignFeatureHistory.belongsTo(models.DesignFeature, {
        foreignKey: 'designFeatureID',
        as: 'feature',
      });
      DesignFeatureHistory.belongsTo(models.User, {
        foreignKey: 'changedByUserID',
        as: 'changedByUser',
      });
    }
  }
  DesignFeatureHistory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    designFeatureID: { type: DataTypes.INTEGER, allowNull: false },
    changedByUserID: { type: DataTypes.INTEGER, allowNull: false },
    changeType: { type: DataTypes.STRING(40), allowNull: false },
    changes: { type: DataTypes.JSON, allowNull: true },
    snapshotData: { type: DataTypes.JSON, allowNull: true },
    changeNotes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    sequelize,
    modelName: 'DesignFeatureHistory',
    tableName: 'DesignFeatureHistory',
    freezeTableName: true,
    timestamps: false,
  });
  return DesignFeatureHistory;
};
