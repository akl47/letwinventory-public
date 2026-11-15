'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class WireHarness extends Model {
    static associate(models) {
      WireHarness.belongsTo(models.Part, {
        foreignKey: 'partID',
        as: 'Part'
      });
      // Self-referential association for revision chains
      WireHarness.belongsTo(models.WireHarness, {
        foreignKey: 'previousRevisionID',
        as: 'PreviousRevision'
      });
      WireHarness.hasMany(models.WireHarness, {
        foreignKey: 'previousRevisionID',
        as: 'NextRevisions'
      });
      WireHarness.belongsTo(models.User, { as: 'lockedBy', foreignKey: 'lockedByUserID' });
      // History association
      WireHarness.hasMany(models.HarnessRevisionHistory, {
        foreignKey: 'harnessID',
        as: 'History'
      });
    }
  };
  WireHarness.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Parts',
        key: 'id'
      }
    },
    revision: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'A'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    harnessData: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    thumbnailBase64: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdBy: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    // Revision control fields
    releaseState: {
      type: DataTypes.ENUM('draft', 'review', 'released'),
      allowNull: false,
      defaultValue: 'draft'
    },
    releasedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    releasedBy: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    previousRevisionID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'WireHarnesses',
        key: 'id'
      }
    },
    // Version-control working-copy state (REQ 1062) — same meaning as the
    // matching DesignCADModels columns; the repository itself lives in the
    // shared VcsObjects/VcsRefs store under repoType 'harness'.
    branchName: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'main' },
    baseCommitHash: { type: DataTypes.STRING(64), allowNull: true },
    dirty: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastContentSavedAt: { type: DataTypes.DATE, allowNull: true },
    lockedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    lockExpiresAt: { type: DataTypes.DATE, allowNull: true },
    releaseLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdByUserID: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE
    }
  }, {
    sequelize,
    modelName: 'WireHarness',
    tableName: 'WireHarnesses',
    freezeTableName: true
  });
  return WireHarness;
};
