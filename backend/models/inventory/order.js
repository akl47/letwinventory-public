'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Order extends Model {
    static associate(models) {
      Order.belongsTo(models.OrderStatus, {
        foreignKey: 'orderStatusID',
        onDelete: 'CASCADE'
      });
      Order.hasMany(models.OrderItem, {
        foreignKey: 'orderID',
        sourceKey: 'id',
        onDelete: 'CASCADE'
      });
    }
  };
  Order.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: true
    },
    trackingNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    link: {
      type: DataTypes.STRING,
      allowNull: true
    },
    placedDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    receivedDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    orderStatusID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
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
    modelName: 'Order',
  });
  return Order;
};
