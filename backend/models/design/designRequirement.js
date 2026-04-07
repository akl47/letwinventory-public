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
      DesignRequirement.belongsTo(models.User, {
        as: 'implementedBy',
        foreignKey: 'implementedByUserID'
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
      allowNull: false
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
      allowNull: false
    },
    validation: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    ownerUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    approvalStatus: {
      type: DataTypes.ENUM('draft', 'unapproved', 'approved'),
      allowNull: false,
      defaultValue: 'draft'
    },
    approvedByUserID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    implementationStatus: {
      type: DataTypes.ENUM('not_implemented', 'implemented', 'validated'),
      allowNull: false,
      defaultValue: 'not_implemented'
    },
    implementedByUserID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    implementedAt: {
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
