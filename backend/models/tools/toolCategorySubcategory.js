'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ToolCategorySubcategory extends Model {
    static associate(_models) {
      // Composite-key join — associations declared on ToolCategory and ToolSubcategory.
    }
  }

  ToolCategorySubcategory.init({
    toolCategoryID: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    toolSubcategoryID: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'ToolCategorySubcategory',
    timestamps: false,
  });

  return ToolCategorySubcategory;
};
