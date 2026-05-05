'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignFeature extends Model {
    static associate(models) {
      DesignFeature.belongsTo(models.Project, {
        as: 'project',
        foreignKey: 'projectID',
      });
      DesignFeature.belongsTo(models.User, {
        as: 'owner',
        foreignKey: 'ownerUserID',
      });
      DesignFeature.belongsTo(models.User, {
        as: 'reviewer',
        foreignKey: 'reviewerUserID',
      });
      DesignFeature.belongsTo(models.User, {
        as: 'approvedBy',
        foreignKey: 'approvedByUserID',
      });
      DesignFeature.belongsTo(models.User, {
        as: 'releasedBy',
        foreignKey: 'releasedByUserID',
      });
      DesignFeature.hasMany(models.DesignRequirement, {
        as: 'requirements',
        foreignKey: 'designFeatureID',
      });
      DesignFeature.hasMany(models.DesignFeatureHistory, {
        as: 'history',
        foreignKey: 'designFeatureID',
      });
    }
  }
  DesignFeature.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    markdownBody: { type: DataTypes.TEXT, allowNull: true },
    projectID: { type: DataTypes.INTEGER, allowNull: false },
    ownerUserID: { type: DataTypes.INTEGER, allowNull: false },
    reviewerUserID: { type: DataTypes.INTEGER, allowNull: true },
    approvedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    releasedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    reviewState: {
      type: DataTypes.ENUM('draft', 'in_review', 'approved', 'released'),
      allowNull: false,
      defaultValue: 'draft',
    },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    approvedAt: { type: DataTypes.DATE, allowNull: true },
    releasedAt: { type: DataTypes.DATE, allowNull: true },
    branchName: { type: DataTypes.STRING(255), allowNull: true },
    prURL: { type: DataTypes.STRING(500), allowNull: true },
    githubRepo: { type: DataTypes.STRING(255), allowNull: true },
    commitRefs: { type: DataTypes.JSON, allowNull: true },
    prState: { type: DataTypes.STRING(20), allowNull: true },
    prTitle: { type: DataTypes.STRING(500), allowNull: true },
    prMergedAt: { type: DataTypes.DATE, allowNull: true },
    prHeadSha: { type: DataTypes.STRING(64), allowNull: true },
    lastSyncedAt: { type: DataTypes.DATE, allowNull: true },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignFeature',
    tableName: 'DesignFeatures',
    indexes: [
      { unique: true, fields: ['slug'], where: { activeFlag: true }, name: 'design_features_slug_unique_active' },
    ],
  });
  return DesignFeature;
};
