'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class HarnessWire extends Model {
    static associate(models) {
      // Associate with Part if it exists
      if (models.Part) {
        HarnessWire.belongsTo(models.Part, {
          foreignKey: 'partID',
          as: 'part'
        });
      }
    }
  }

  HarnessWire.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Wire label (e.g., W1, GND)'
    },
    color: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Color name (Black, Red)'
    },
    colorCode: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Color code (BK, RD)'
    },
    gaugeAWG: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Wire gauge (22, 18, etc.)'
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
    modelName: 'HarnessWire',
    tableName: 'HarnessWires',
    freezeTableName: true
  });

  return HarnessWire;
};
