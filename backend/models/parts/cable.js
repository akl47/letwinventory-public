'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Cable extends Model {
    static associate(models) {
      // Associate with Part if it exists
      if (models.Part) {
        Cable.belongsTo(models.Part, {
          foreignKey: 'partID',
          as: 'part'
        });
      }
    }
  }

  Cable.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Cable label (e.g., CABLE-A)'
    },
    wireCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    gaugeAWG: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Wire gauge for all wires in cable'
    },
    wires: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      comment: 'Array of wire definitions [{id, color, colorCode}]'
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
    cableDiagramImage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded cable diagram image'
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
    modelName: 'Cable',
    tableName: 'Cables',
    freezeTableName: true
  });

  return Cable;
};
