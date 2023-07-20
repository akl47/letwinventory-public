'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('BarcodeCategories', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      name: {
        type: DataTypes.STRING,
        allowNull:false,
        unique:true
      },
      prefix: {
        type: DataTypes.STRING(3),
        allowNull:false,
        unique: true
      },
      tableName: {
        type: DataTypes.STRING,
        allowNull:false,
        unique:true
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
    await queryInterface.dropTable('BarcodeCategories');
  }
};