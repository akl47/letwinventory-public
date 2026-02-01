'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class WireEnd extends Model {
    static associate(models) {
      // No associations needed for now
    }
  }

  WireEnd.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
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
    modelName: 'WireEnd',
    tableName: 'WireEnds',
    freezeTableName: true
  });

  return WireEnd;
};
