const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserGroupMember extends Model {
    static associate(models) {
      UserGroupMember.belongsTo(models.User, { foreignKey: 'userID', as: 'user' });
      UserGroupMember.belongsTo(models.UserGroup, { foreignKey: 'groupID', as: 'group' });
    }
  }

  UserGroupMember.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userID: { type: DataTypes.INTEGER, allowNull: false },
    groupID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    sequelize,
    modelName: 'UserGroupMember',
    updatedAt: false
  });

  return UserGroupMember;
};
