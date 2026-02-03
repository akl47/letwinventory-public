'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class HarnessRevisionHistory extends Model {
    static associate(models) {
      HarnessRevisionHistory.belongsTo(models.WireHarness, {
        foreignKey: 'harnessID',
        as: 'Harness'
      });
    }
  };
  HarnessRevisionHistory.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    harnessID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'WireHarnesses',
        key: 'id'
      }
    },
    revision: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    releaseState: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    changedBy: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    changeType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['created', 'updated', 'submitted_review', 'rejected', 'released', 'new_revision']]
      }
    },
    changeNotes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    snapshotData: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE
    }
  }, {
    sequelize,
    modelName: 'HarnessRevisionHistory',
    tableName: 'HarnessRevisionHistory',
    freezeTableName: true,
    timestamps: false  // Only createdAt, no updatedAt
  });
  return HarnessRevisionHistory;
};
