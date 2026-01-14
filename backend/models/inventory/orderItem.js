'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class OrderItem extends Model {

    static associate(models) {
      OrderItem.belongsTo(models.Order, {
        foreignKey: 'orderID',
        targetKey: 'id',
        onDelete: 'CASCADE'
      });
      OrderItem.belongsTo(models.Part, {
        foreignKey: 'partID',
        onDelete: 'CASCADE'
      });
      OrderItem.belongsTo(models.OrderLineType, {
        foreignKey: 'orderLineTypeID',
        onDelete: 'CASCADE'
      });
      OrderItem.hasMany(models.Trace, {
        foreignKey: 'orderItemID',
        onDelete: 'CASCADE'
      });
    }
  };
  OrderItem.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    orderID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    orderLineTypeID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    lineNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    price: {
      type: DataTypes.DECIMAL(10, 5),
      allowNull: false,
      defaultValue: 0.00
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    receivedQuantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
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