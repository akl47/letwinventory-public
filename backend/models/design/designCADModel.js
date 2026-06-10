'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DesignCADModel extends Model {
    static associate(models) {
      DesignCADModel.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
      DesignCADModel.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdByUserID' });
      DesignCADModel.belongsTo(models.User, { as: 'lockedBy', foreignKey: 'lockedByUserID' });
      DesignCADModel.hasMany(models.DesignCADModelHistory, { as: 'history', foreignKey: 'cadModelID' });
    }
  }
  DesignCADModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: true },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    // Model defaults let assembly rows be created without fabricating CAD
    // content — they carry empty trees and their document in assemblyDoc.
    featureTree: { type: DataTypes.JSONB, allowNull: false, defaultValue: { features: [], nextFeatureSeq: 1 } },
    sketchDoc: { type: DataTypes.JSONB, allowNull: false, defaultValue: { sketches: {}, nextSketchSeq: 1 } },
    // ── unified design table (assemblies merged in) ───────────────────────
    // True for assembly rows: the design document is `assemblyDoc` (instances/
    // mates/patterns/...) instead of featureTree+sketchDoc, the VCS binding is
    // the assembly one (repoType 'assembly', assemblySerializer), and the
    // domain operations live under /api/design/assembly. One active design row
    // exists per part, of exactly one kind (the partial unique index enforces it).
    isAssembly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    assemblyDoc: { type: DataTypes.JSONB, allowNull: true },
    // SolidWorks-style equations doc — { entries: { name: { expression,
    // lastValue?, error? } } }. Keys are either global names (no dot)
    // or target paths (feature.<id>.distance, sketch.<id>.constraint.<id>,
    // …). Resolved by cadEquations.applyEquationsToModel at regen time.
    equations: { type: DataTypes.JSONB, allowNull: false, defaultValue: { entries: {} } },
    // ── VCS working-copy state (Phase 1) ──────────────────────────────────
    // The model row IS the editable working copy; commits/branches/tags live in
    // the VcsObject/VcsRef store. These columns track which branch the copy is
    // on, the commit it was checked out from, whether it has uncommitted edits,
    // and the exclusive edit lock (PDM-style checkout).
    branchName: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'main' },
    baseCommitHash: { type: DataTypes.STRING(64), allowNull: true },
    dirty: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lockedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    lockExpiresAt: { type: DataTypes.DATE, allowNull: true },
    // Saved camera orientation for the Default-view control + commit thumbnails
    // (REQ 708/709). A view preference, not versioned doc content, so it is
    // editable without a checkout. Shape: { theta, phi, distance, target:[x,y,z] }.
    defaultView: { type: DataTypes.JSONB, allowNull: true },
    // Set true by a development release (REQ 715-718): the design is locked
    // read-only and edits require a new revision. Distinct from the checkout
    // edit-lock (lockedByUserID) and from Parts.revisionLocked.
    releaseLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdByUserID: { type: DataTypes.INTEGER, allowNull: false },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignCADModel',
    tableName: 'DesignCADModels',
    indexes: [
      // One working copy per part (revisions are VCS tags, not extra rows).
      { unique: true, fields: ['partID'], where: { activeFlag: true }, name: 'design_cad_models_part_unique_active' },
    ],
  });
  return DesignCADModel;
};
