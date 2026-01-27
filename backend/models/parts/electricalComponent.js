'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ElectricalComponent extends Model {
    static associate(models) {
      // Associate with Part if it exists
      if (models.Part) {
        ElectricalComponent.belongsTo(models.Part, {
          foreignKey: 'partID',
          as: 'part'
        });
      }
    }
  }

  ElectricalComponent.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Component label/reference designator (e.g., U1, R2, C3)'
    },
    pinCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    pins: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      comment: 'Array of pin groups [{id, name, pinTypeID, pins: [{id, number, label}]}]'
    },
    pinoutDiagramImage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded pinout diagram image'
    },
    componentImage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded component image'
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
    modelName: 'ElectricalComponent',
    tableName: 'ElectricalComponents',
    freezeTableName: true
  });

  return ElectricalComponent;
};
