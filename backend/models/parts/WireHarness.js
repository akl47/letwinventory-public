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
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'draft',
      validate: {
        isIn: [['draft', 'review', 'released']]
      }
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
