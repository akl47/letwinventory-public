'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ElectricalPinType extends Model {
    static associate(models) {
      // ElectricalPinType has many ElectricalConnectors
      if (models.ElectricalConnector) {
        ElectricalPinType.hasMany(models.ElectricalConnector, {
          foreignKey: 'electricalPinTypeID',
          as: 'connectors'
        });
      }
    }
  }

  ElectricalPinType.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
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
    modelName: 'ElectricalPinType',
    tableName: 'ElectricalPinTypes',
    freezeTableName: true
  });

  return ElectricalPinType;
};
