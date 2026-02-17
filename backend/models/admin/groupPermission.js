const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GroupPermission extends Model {
    static associate(models) {
      GroupPermission.belongsTo(models.UserGroup, { foreignKey: 'groupID', as: 'group' });
      GroupPermission.belongsTo(models.Permission, { foreignKey: 'permissionID', as: 'permission' });
    }
  }

  GroupPermission.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    groupID: { type: DataTypes.INTEGER, allowNull: false },
    permissionID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'GroupPermission',
    updatedAt: false
  });

  return GroupPermission;
};
