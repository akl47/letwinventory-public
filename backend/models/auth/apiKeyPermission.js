const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ApiKeyPermission extends Model {
    static associate(models) {
      ApiKeyPermission.belongsTo(models.ApiKey, { foreignKey: 'apiKeyID', as: 'apiKey' });
      ApiKeyPermission.belongsTo(models.Permission, { foreignKey: 'permissionID', as: 'permission' });
    }
  }

  ApiKeyPermission.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    apiKeyID: { type: DataTypes.INTEGER, allowNull: false },
    permissionID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'ApiKeyPermission',
    updatedAt: false
  });

  return ApiKeyPermission;
};
