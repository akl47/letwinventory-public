'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Trace extends Model {
    static associate(models) {
      Trace.belongsTo(models.Barcode,{
        foreignKey: 'barcodeID',
        onDelete: 'CASCADE'
      })
      Trace.belongsTo(models.Part,{
        foreignKey: 'partID',
        onDelete: 'CASCADE'
      })
    }
  };
  Trace.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    orderItemID: {
      type: DataTypes.INTEGER,
      allowNull: true
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
    modelName: 'Trace',
  });
  return Trace;
};