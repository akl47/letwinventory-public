const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserPermission extends Model {
    static associate(models) {
      UserPermission.belongsTo(models.User, { foreignKey: 'userID', as: 'user' });
      UserPermission.belongsTo(models.Permission, { foreignKey: 'permissionID', as: 'permission' });
    }
  }

  UserPermission.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userID: { type: DataTypes.INTEGER, allowNull: false },
    permissionID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'UserPermission',
    updatedAt: false
  });

  return UserPermission;
};
