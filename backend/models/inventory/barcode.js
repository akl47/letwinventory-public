'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Barcode extends Model {
    static associate(models) {
      Barcode.belongsTo(models.BarcodeCategory, {
        foreignKey: 'barcodeCategoryID',
        onDelete: 'CASCADE'
      })
      Barcode.hasOne(models.Location, {
        foreignKey: 'barcodeID',
        as: 'location'
      })
      Barcode.hasOne(models.Box, {
        foreignKey: 'barcodeID',
        as: 'box'
      })
    }
  };
  Barcode.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    barcode: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    parentBarcodeID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    barcodeCategoryID: {
      type: DataTypes.INTEGER,
      allowNull: false
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
    hooks: {
      beforeValidate: async (barcode, options) => {
        // Only generate barcode if it's undefined and we have a category ID
        if (typeof barcode.barcode == 'undefined' && barcode.barcodeCategoryID) {
          let next_barcode_value;
          if (sequelize.getDialect() === 'sqlite') {
            const max = await sequelize.models.Barcode.max('id');
            next_barcode_value = (max || 0) + 1;
          } else {
            const next_id = await sequelize.query("SELECT * FROM \"Barcodes_id_seq\";", { raw: true })
            if (next_id[0][0].is_called) {
              next_barcode_value = parseInt(next_id[0][0].last_value) + 1
            } else {
              next_barcode_value = parseInt(next_id[0][0].last_value)
            }
          }
          let prefix = await sequelize.query("select prefix from \"BarcodeCategories\" where id = :id", {
            replacements: { id: barcode.barcodeCategoryID },
            type: sequelize.QueryTypes.SELECT
          })

          barcode.barcode = prefix[0].prefix + '-' + (next_barcode_value).toString(16).padStart(6, '0').toUpperCase();
          console.log("Generated barcode:", barcode.barcode)
        }
      },
    },
    sequelize,
    modelName: 'Barcode',
  });
  return Barcode;
};