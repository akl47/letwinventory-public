'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignAssembly extends Model {
    static associate(models) {
      DesignAssembly.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
      DesignAssembly.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdByUserID' });
      DesignAssembly.belongsTo(models.User, { as: 'lockedBy', foreignKey: 'lockedByUserID' });
      DesignAssembly.hasMany(models.DesignAssemblyHistory, { as: 'history', foreignKey: 'assemblyID' });
    }
  }
  DesignAssembly.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: true },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    // The versioned assembly document — { nextInstanceSeq, nextMateSeq,
    // instances: [{ instanceId, partID, ref:{kind,repoId}, pinnedCommitHash,
    // grounded, placement:{translate,quaternion}, suppressed, visible }],
    // mates: [] (Phase 2) }. Resolved/composed by assemblyRegenService.
    assemblyDoc: { type: DataTypes.JSONB, allowNull: false },
    // ── VCS working-copy state (mirrors DesignCADModel) ───────────────────
    branchName: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'main' },
    baseCommitHash: { type: DataTypes.STRING(64), allowNull: true },
    dirty: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lockedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    lockExpiresAt: { type: DataTypes.DATE, allowNull: true },
    defaultView: { type: DataTypes.JSONB, allowNull: true },
    releaseLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdByUserID: { type: DataTypes.INTEGER, allowNull: false },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignAssembly',
    tableName: 'DesignAssemblies',
    indexes: [
      { unique: true, fields: ['partID'], where: { activeFlag: true }, name: 'design_assemblies_part_unique_active' },
    ],
  });
  return DesignAssembly;
};
