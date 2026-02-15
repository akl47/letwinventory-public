'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignRequirement extends Model {
    static associate(models) {
      DesignRequirement.belongsTo(models.DesignRequirement, {
        as: 'parentRequirement',
        foreignKey: 'parentRequirementID'
      });
      DesignRequirement.hasMany(models.DesignRequirement, {
        as: 'childRequirements',
        foreignKey: 'parentRequirementID'
      });
      DesignRequirement.belongsTo(models.User, {
        as: 'owner',
        foreignKey: 'ownerUserID'
      });
      DesignRequirement.belongsTo(models.User, {
        as: 'approvedBy',
        foreignKey: 'approvedByUserID'
      });
      DesignRequirement.belongsTo(models.Project, {
        as: 'project',
        foreignKey: 'projectID'
      });
      DesignRequirement.belongsTo(models.RequirementCategory, {
        as: 'category',
        foreignKey: 'categoryID'
      });
    }
  };
  DesignRequirement.init({
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    rationale: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    parameter: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    parentRequirementID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    projectID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    categoryID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    verification: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    validation: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ownerUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    approved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    approvedByUserID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true
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
    modelName: 'DesignRequirement',
  });

  return DesignRequirement;
};
