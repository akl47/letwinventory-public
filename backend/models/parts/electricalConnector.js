'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ElectricalConnector extends Model {
    static associate(models) {
      // Associate with Part if it exists
      if (models.Part) {
        ElectricalConnector.belongsTo(models.Part, {
          foreignKey: 'partID',
          as: 'part'
        });
      }
      // Associate with ElectricalPinType if it exists
      if (models.ElectricalPinType) {
        ElectricalConnector.belongsTo(models.ElectricalPinType, {
          foreignKey: 'electricalPinTypeID',
          as: 'pinType'
        });
      }
    }
  }

  ElectricalConnector.init({
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
    electricalPinTypeID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ElectricalPinTypes',
        key: 'id'
      },
      comment: 'Link to ElectricalPinType'
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
    modelName: 'ElectricalConnector',
    tableName: 'ElectricalConnectors',
    freezeTableName: true
  });

  return ElectricalConnector;
};
