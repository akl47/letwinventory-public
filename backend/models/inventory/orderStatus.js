'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OrderStatus extends Model {
    static associate(models) {
      OrderStatus.hasMany(models.Order, {
        foreignKey: 'orderStatusID',
        onDelete: 'CASCADE'
      });

      // Self-referential association for next status in workflow
      OrderStatus.belongsTo(models.OrderStatus, {
        foreignKey: 'nextStatusID',
        as: 'NextStatus',
        onDelete: 'SET NULL'
      });
    }
  }

  OrderStatus.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    tagColor: {
      type: DataTypes.STRING(7),
      allowNull: true,
      comment: 'Hex color code for status tag (e.g., #FF5733)'
    },
    nextStatusID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID of the next status in the workflow'
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
    modelName: 'OrderStatus',
  });

  return OrderStatus;
};
