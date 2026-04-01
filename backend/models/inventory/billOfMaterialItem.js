'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class BillOfMaterialItem extends Model {
    static associate(models) {
      BillOfMaterialItem.belongsTo(models.Part, {
        foreignKey: 'partID',
        as: 'parentPart'
      });
      BillOfMaterialItem.belongsTo(models.Part, {
        foreignKey: 'componentPartID',
        as: 'componentPart'
      });
    }
  };
  BillOfMaterialItem.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Parts',
        key: 'id'
      }
    },
    componentPartID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Parts',
        key: 'id'
      }
    },
    quantity: {
      type: DataTypes.FLOAT,
      allowNull: false
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
    modelName: 'BillOfMaterialItem',
  });
  return BillOfMaterialItem;
};
