'use strict';
const { Model } = require('sequelize');

// REQ 676 (VC-8) — where-used index (assembly seam). When an assembly commit
// references a child part's commit via a `component` object, a row here records
// the reverse edge so impact analysis ("revise this child → which assemblies
// use it?") is a single indexed lookup instead of a full scan. Maintained when
// assembly commits are written; trivially empty for single-part repos today.
module.exports = (sequelize, DataTypes) => {
  class VcsUsage extends Model {}
  VcsUsage.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    childRepoType: { type: DataTypes.STRING(32), allowNull: false },
    childRepoId: { type: DataTypes.STRING(64), allowNull: false },
    parentRepoType: { type: DataTypes.STRING(32), allowNull: false },
    parentRepoId: { type: DataTypes.STRING(64), allowNull: false },
    parentCommitHash: { type: DataTypes.STRING(64), allowNull: false },
    instanceId: { type: DataTypes.STRING(128), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'VcsUsage',
    tableName: 'VcsUsages',
    updatedAt: false,
    indexes: [
      { fields: ['childRepoType', 'childRepoId'], name: 'vcs_usages_child_idx' },
      { fields: ['parentRepoType', 'parentRepoId', 'parentCommitHash'], name: 'vcs_usages_parent_idx' },
    ],
  });
  return VcsUsage;
};
