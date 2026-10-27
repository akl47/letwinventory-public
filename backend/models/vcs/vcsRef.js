'use strict';
const { Model } = require('sequelize');

// REQ 673 (VC-5) — named references into a repo's commit graph. Branches are
// mutable pointers (variant lines of development); tags are write-once
// (immutable release markers). Unique on (repoType, repoId, name).
module.exports = (sequelize, DataTypes) => {
  class VcsRef extends Model {}
  VcsRef.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    repoType: { type: DataTypes.STRING(32), allowNull: false },
    repoId: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    kind: {
      type: DataTypes.STRING(8), allowNull: false,
      validate: { isIn: [['branch', 'tag']] },
    },
    targetHash: { type: DataTypes.STRING(64), allowNull: false },
    updatedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'VcsRef',
    tableName: 'VcsRefs',
    indexes: [
      { unique: true, fields: ['repoType', 'repoId', 'name'], name: 'vcs_refs_repo_name_unique' },
    ],
  });
  return VcsRef;
};
