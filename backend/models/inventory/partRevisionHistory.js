'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PartRevisionHistory extends Model {
    static associate(models) {
      PartRevisionHistory.belongsTo(models.Part, {
        foreignKey: 'partID',
        as: 'part'
      });
      PartRevisionHistory.belongsTo(models.User, {
        foreignKey: 'changedByUserID',
        as: 'changedBy'
      });
    }
  };
  PartRevisionHistory.init({
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    changedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    changeType: {
      type: DataTypes.STRING(20), allowNull: false,
      validate: { isIn: [['created', 'updated', 'locked', 'unlocked', 'new_revision', 'production_release']] }
    },
    changes: { type: DataTypes.JSON, allowNull: true },
    createdAt: { allowNull: false, type: DataTypes.DATE }
  }, {
    sequelize, modelName: 'PartRevisionHistory', tableName: 'PartRevisionHistory',
    freezeTableName: true, timestamps: false
  });
  return PartRevisionHistory;
};
