'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class OrderItem extends Model {

    static associate(models) {
      OrderItem.belongsTo(models.Order,{
        foreignKey: 'orderNum',
        onDelete: 'CASCADE'
      })
      OrderItem.hasMany(models.Trace,{
        foreignKey: 'orderItemID',
        onDelete: 'CASCADE'
      })
    }
  };
  OrderItem.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    orderItemID: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    orderNum: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    sku: {
      type: DataTypes.STRING,
      allowNull: true
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: true
    },
    quantity:{
      type: DataTypes.STRING,
      allowNull: false
    },
    unit: {
      type: DataTypes.STRING,
      allowNull: false
    },
    unitPrice: {
      type: DataTypes.FLOAT,
      allowNull: false
    },
    status: {
      type: DataTypes.INTEGER,
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
    modelName: 'OrderItem',
  });
  return OrderItem;
};