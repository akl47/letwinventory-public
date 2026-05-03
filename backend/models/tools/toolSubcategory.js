'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ToolSubcategory extends Model {
    static associate(models) {
      ToolSubcategory.belongsToMany(models.ToolCategory, {
        through: models.ToolCategorySubcategory,
        as: 'categories',
        foreignKey: 'toolSubcategoryID',
        otherKey: 'toolCategoryID',
      });
      ToolSubcategory.hasMany(models.Tool, { as: 'tools', foreignKey: 'toolSubcategoryID' });
    }
  }

  ToolSubcategory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(255) },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'ToolSubcategory',
  });

  return ToolSubcategory;
};
