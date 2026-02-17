'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ApiKey extends Model {
    static associate(models) {
      ApiKey.belongsTo(models.User, {
        foreignKey: 'userID',
        as: 'user'
      });
      ApiKey.belongsToMany(models.Permission, {
        through: models.ApiKeyPermission,
        foreignKey: 'apiKeyID',
        otherKey: 'permissionID',
        as: 'permissions'
      });
    }
  }

  ApiKey.init({
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    keyHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    userID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'ApiKey',
    tableName: 'ApiKeys'
  });

  return ApiKey;
};
