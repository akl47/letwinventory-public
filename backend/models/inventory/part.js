'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Part extends Model {
    static associate(models) {
      Part.hasMany(models.Trace,{
        foreignKey: 'partID',
        onDelete: 'CASCADE'
      })
      Part.belongsTo(models.PartCategory, {
        foreignKey: 'partCategoryID',
        onDelete: 'CASCADE'
      });
      Part.belongsTo(models.UnitOfMeasure, {
        foreignKey: 'defaultUnitOfMeasureID',
        as: 'UnitOfMeasure'
      });
      Part.belongsTo(models.UploadedFile, {
        foreignKey: 'imageFileID',
        as: 'imageFile'
      });
      Part.hasOne(models.ElectricalConnector, {
        foreignKey: 'partID',
        as: 'electricalConnector'
      });
      Part.hasOne(models.Cable, {
        foreignKey: 'partID',
        as: 'cable'
      });
      Part.hasOne(models.ElectricalComponent, {
        foreignKey: 'partID',
        as: 'electricalComponent'
      });
    }
  };
  Part.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    name:{
      type: DataTypes.STRING(32),
      allowNull:false,
      unique:true
    },
    description: {
      type: DataTypes.STRING(62),
      allowNull:true
    },
    internalPart: {
      type: DataTypes.BOOLEAN,
      allowNull:false,
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull:false
    },
    sku:{
      type: DataTypes.STRING,
      allowNull:true
    },
    link: {
      type: DataTypes.STRING,
      allowNull:true
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull:false,
      defaultValue:true
    },
    minimumOrderQuantity: {
      type: DataTypes.INTEGER,
      allowNull:false
    },
    partCategoryID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    serialNumberRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    lotNumberRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    defaultUnitOfMeasureID: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1 // Default to 'ea'
    },
    manufacturer: {
      type: DataTypes.STRING,
      allowNull: true
    },
    manufacturerPN: {
      type: DataTypes.STRING,
      allowNull: true
    },
    imageFileID: {
      type: DataTypes.INTEGER,
      allowNull: true
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
    modelName: 'Part',
  });
  return Part;
};