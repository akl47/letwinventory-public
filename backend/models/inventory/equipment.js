'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Equipment extends Model {
    static associate(models) {
      Equipment.belongsTo(models.Barcode, {
        foreignKey: 'barcodeID',
        onDelete: 'CASCADE'
      });
      Equipment.belongsTo(models.Part, {
        foreignKey: 'partID',
        onDelete: 'SET NULL'
      });
      Equipment.belongsTo(models.OrderItem, {
        foreignKey: 'orderItemID',
        onDelete: 'SET NULL'
      });
    }
  };
  Equipment.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    serialNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    commissionDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    barcodeID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true
    },
    partID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    orderItemID: {
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
    modelName: 'Equipment',
    tableName: 'Equipment',
    freezeTableName: true
  });
  return Equipment;
};
