'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RequirementHistory extends Model {
    static associate(models) {
      RequirementHistory.belongsTo(models.DesignRequirement, {
        foreignKey: 'requirementID',
        as: 'requirement'
      });
      RequirementHistory.belongsTo(models.User, {
        foreignKey: 'changedByUserID',
        as: 'changedBy'
      });
    }
  };
  RequirementHistory.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    requirementID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    changedByUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    changeType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['created', 'updated', 'approved', 'unapproved', 'deleted']]
      }
    },
    changes: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    changeNotes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE
    }
  }, {
    sequelize,
    modelName: 'RequirementHistory',
    tableName: 'RequirementHistory',
    freezeTableName: true,
    timestamps: false
  });
  return RequirementHistory;
};
