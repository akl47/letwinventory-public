'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignCADModelHistory extends Model {
    static associate(models) {
      DesignCADModelHistory.belongsTo(models.DesignCADModel, { as: 'cadModel', foreignKey: 'cadModelID' });
      DesignCADModelHistory.belongsTo(models.User, { as: 'changedBy', foreignKey: 'changedByUserID' });
    }
  }
  DesignCADModelHistory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cadModelID: { type: DataTypes.INTEGER, allowNull: false },
    changeType: { type: DataTypes.STRING(30), allowNull: false },
    changedByUserID: { type: DataTypes.INTEGER, allowNull: false },
    previousState: { type: DataTypes.JSONB, allowNull: true },
    newState: { type: DataTypes.JSONB, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignCADModelHistory',
    tableName: 'DesignCADModelHistory',
    timestamps: false,
  });
  return DesignCADModelHistory;
};
