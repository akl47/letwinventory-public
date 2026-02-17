const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserGroup extends Model {
    static associate(models) {
      UserGroup.belongsToMany(models.User, {
        through: models.UserGroupMember,
        foreignKey: 'groupID',
        otherKey: 'userID',
        as: 'members'
      });
      UserGroup.belongsToMany(models.Permission, {
        through: models.GroupPermission,
        foreignKey: 'groupID',
        otherKey: 'permissionID',
        as: 'permissions'
      });
    }
  }

  UserGroup.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    activeFlag: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'UserGroup'
  });

  return UserGroup;
};
