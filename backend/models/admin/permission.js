const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Permission extends Model {
    static associate(models) {
      // Accessed via junction tables (GroupPermission, UserPermission)
    }
  }

  Permission.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.STRING(50), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'Permission',
    updatedAt: false
  });

  return Permission;
};
