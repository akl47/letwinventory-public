'use strict';
const { Model } = require('sequelize');

// REQ 668-676 — content-addressed VCS object store. An object is immutable and
// identified by sha256 of its canonical content; the same content stored twice
// occupies one row. Scoped per repository = (repoType, repoId). `content` holds
// JSON kinds (blob/tree/commit/component); `bytes` holds binary kinds
// (geometry). Exactly one of the two is set per row.
module.exports = (sequelize, DataTypes) => {
  class VcsObject extends Model {}
  VcsObject.init({
    repoType: { type: DataTypes.STRING(32), primaryKey: true, allowNull: false },
    repoId: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    // sha256 hex of (kind + canonical content)
    hash: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    kind: {
      type: DataTypes.STRING(16), allowNull: false,
      validate: { isIn: [['blob', 'tree', 'commit', 'geometry', 'component']] },
    },
    content: { type: DataTypes.JSONB, allowNull: true },
    bytes: { type: DataTypes.BLOB, allowNull: true },
    size: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'VcsObject',
    tableName: 'VcsObjects',
    updatedAt: false, // objects are immutable
  });
  return VcsObject;
};
