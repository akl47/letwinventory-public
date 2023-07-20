'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('Parts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      name:{
        type: DataTypes.STRING(16),
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
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Parts');
  }
};