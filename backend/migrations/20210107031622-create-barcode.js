'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('Barcodes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      barcode: {
        type: DataTypes.STRING,
        allowNull:false
      },
      parentBarcodeID: {
        type: DataTypes.INTEGER,
        allowNull:false
      },
      barcodeCategoryID: {
        type: DataTypes.INTEGER,
        allowNull:false
      },
      activeFlag: {
        type: DataTypes.BOOLEAN,
        allowNull:false,
        defaultValue:true
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE
      }
    });
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('Barcodes');
  }
};