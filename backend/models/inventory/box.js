'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Box extends Model {
    static associate(models) {
      Box.belongsTo(models.Barcode,{
        foreignKey: 'barcodeID',
        onDelete: 'CASCADE'
      })
    }
  };
  Box.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name:{
      type: DataTypes.STRING(16),
      allowNull:true
    },
    description: {
      type: DataTypes.STRING(62),
      allowNull:true
    },
    barcodeID: {
      type: DataTypes.INTEGER,
      allowNull:false,
      unique:true
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull:false,
      defaultValue:true
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
    modelName: 'Box',
  });
  return Box;
};