'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ShipmentTracking extends Model {
    static associate(models) {
      ShipmentTracking.belongsTo(models.Order, {
        foreignKey: 'orderID',
        onDelete: 'SET NULL'
      });
      ShipmentTracking.belongsTo(models.User, {
        foreignKey: 'ownerUserID',
        onDelete: 'CASCADE'
      });
    }
  };
  ShipmentTracking.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    orderID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    ownerUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    trackingNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    carrier: {
      type: DataTypes.ENUM('usps', 'ups', 'fedex', 'dhl', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown'
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true
    },
    statusDetail: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    estimatedDelivery: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastCheckedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    trackingData: {
      type: DataTypes.JSON,
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
    modelName: 'ShipmentTracking',
  });
  return ShipmentTracking;
};
