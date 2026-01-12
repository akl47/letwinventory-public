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
      Trace.belongsTo(models.UnitOfMeasure,{
        foreignKey: 'unitOfMeasureID',
        as: 'unitOfMeasure'
      })
      Trace.belongsTo(models.OrderItem,{
        foreignKey: 'orderItemID',
        onDelete: 'SET NULL'
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
      type: DataTypes.FLOAT,
      allowNull: false
    },
    unitOfMeasureID: {
      type: DataTypes.INTEGER,
      allowNull: true
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
    serialNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    lotNumber: {
      type: DataTypes.STRING,
      allowNull: true
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