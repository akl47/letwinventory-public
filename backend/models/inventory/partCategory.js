'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PartCategory extends Model {
    static associate(models) {
      // PartCategory has many Parts
      PartCategory.hasMany(models.Part, {
        foreignKey: 'partCategoryID',
        onDelete: 'CASCADE'
      });
    }
  };
  PartCategory.init({
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
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    tagColorHex: {
      type: DataTypes.STRING(7),
      allowNull: true,
      defaultValue: '#808080'
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
    modelName: 'PartCategory',
  });
  return PartCategory;
};
