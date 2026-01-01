'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class BarcodeCategory extends Model {
    static associate(models) {}
  };
  BarcodeCategory.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name: {
      type: DataTypes.STRING,
      allowNull:false,
      unique:true
    },
    prefix: {
      type: DataTypes.STRING(3),
      allowNull:false,
      unique: true
    },
    tableName: {
      type: DataTypes.STRING,
      allowNull:false,
      unique:true
    },
    // TODO add validation that table name is a real table?
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
    modelName: 'BarcodeCategory',
  });
  return BarcodeCategory;
};