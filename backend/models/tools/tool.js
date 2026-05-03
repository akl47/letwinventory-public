'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Tool extends Model {
    static associate(models) {
      Tool.belongsTo(models.Part, { as: 'part', foreignKey: 'partID' });
      Tool.belongsTo(models.ToolSubcategory, { as: 'toolSubcategory', foreignKey: 'toolSubcategoryID' });
    }
  }

  Tool.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    partID: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    toolSubcategoryID: { type: DataTypes.INTEGER, allowNull: false },
    diameter:             { type: DataTypes.DECIMAL(10, 3) },
    overallLength:        { type: DataTypes.DECIMAL(10, 3) },
    fluteLength:          { type: DataTypes.DECIMAL(10, 3) },
    shankDiameter:        { type: DataTypes.DECIMAL(10, 3) },
    cornerRadius:         { type: DataTypes.DECIMAL(10, 3) },
    reducedShankDiameter: { type: DataTypes.DECIMAL(10, 3) },
    squareDriveSize:      { type: DataTypes.DECIMAL(10, 3) },
    numberOfSteps:        { type: DataTypes.INTEGER },
    stepDelta:            { type: DataTypes.DECIMAL(10, 3) },
    numberOfFlutes:       { type: DataTypes.INTEGER },
    tipAngle:             { type: DataTypes.DECIMAL(5, 2) },
    toolMaterial:         { type: DataTypes.STRING(64) },
    coating:              { type: DataTypes.STRING(64) },
    notes:                { type: DataTypes.TEXT },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'Tool',
  });

  return Tool;
};
