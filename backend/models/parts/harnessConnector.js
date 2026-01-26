'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class HarnessConnector extends Model {
    static associate(models) {
      // Associate with Part if it exists
      if (models.Part) {
        HarnessConnector.belongsTo(models.Part, {
          foreignKey: 'partID',
          as: 'part'
        });
      }
    }
  }

  HarnessConnector.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Connector label (e.g., J1, P2, CN1)'
    },
    type: {
      type: DataTypes.ENUM('male', 'female', 'terminal', 'splice'),
      allowNull: false
    },
    pinCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    color: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Color code (GY, BK, RD)'
    },
    pins: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      comment: 'Array of pin definitions [{id, number, label}]'
    },
    pinoutDiagramImage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded pinout diagram image'
    },
    connectorImage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded connector image'
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Parts',
        key: 'id'
      },
      comment: 'Link to inventory Part'
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
    modelName: 'HarnessConnector',
    tableName: 'HarnessConnectors',
    freezeTableName: true
  });

  return HarnessConnector;
};
