'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ToolCategory extends Model {
    static associate(models) {
      ToolCategory.belongsToMany(models.ToolSubcategory, {
        through: models.ToolCategorySubcategory,
        as: 'subcategories',
        foreignKey: 'toolCategoryID',
        otherKey: 'toolSubcategoryID',
      });
    }
  }

  ToolCategory.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(255) },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'ToolCategory',
  });

  return ToolCategory;
};
