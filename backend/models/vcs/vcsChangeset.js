'use strict';
const { Model } = require('sequelize');

// Cross-repo changeset seam (reserved). Groups commits made across multiple
// repos into one logical atomic check-in (e.g. a part edit + the assembly that
// uses it). The table exists so the relationship can be recorded from day one;
// atomic enforcement is wired up when the assembly editor lands.
module.exports = (sequelize, DataTypes) => {
  class VcsChangeset extends Model {}
  VcsChangeset.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    description: { type: DataTypes.STRING(1024), allowNull: true },
    authorUserID: { type: DataTypes.INTEGER, allowNull: true },
    // [{ repoType, repoId, commitHash }] — the commits this changeset bundles.
    commits: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'VcsChangeset',
    tableName: 'VcsChangesets',
    updatedAt: false,
  });
  return VcsChangeset;
};
