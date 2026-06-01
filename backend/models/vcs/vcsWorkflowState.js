'use strict';
const { Model } = require('sequelize');

// REQ 703 (VC-35) — generic per-repository workflow state for the declarative
// workflow engine. Keyed by (repoType, repoId) so any entity type can adopt a
// workflow without its own state column. Absence of a row = the workflow's
// initial state.
module.exports = (sequelize, DataTypes) => {
  class VcsWorkflowState extends Model {}
  VcsWorkflowState.init({
    repoType: { type: DataTypes.STRING(32), primaryKey: true, allowNull: false },
    repoId: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    state: { type: DataTypes.STRING(32), allowNull: false },
    updatedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'VcsWorkflowState',
    tableName: 'VcsWorkflowStates',
    createdAt: false,
  });
  return VcsWorkflowState;
};
