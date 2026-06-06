'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignAssemblyHistory extends Model {
    static associate(models) {
      DesignAssemblyHistory.belongsTo(models.DesignAssembly, { as: 'assembly', foreignKey: 'assemblyID' });
      DesignAssemblyHistory.belongsTo(models.User, { as: 'changedBy', foreignKey: 'changedByUserID' });
    }
  }
  DesignAssemblyHistory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    assemblyID: { type: DataTypes.INTEGER, allowNull: false },
    changeType: { type: DataTypes.STRING(30), allowNull: false },
    changedByUserID: { type: DataTypes.INTEGER, allowNull: false },
    previousState: { type: DataTypes.JSONB, allowNull: true },
    newState: { type: DataTypes.JSONB, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignAssemblyHistory',
    tableName: 'DesignAssemblyHistory',
    timestamps: false,
  });
  return DesignAssemblyHistory;
};
