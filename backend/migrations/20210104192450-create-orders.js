'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('Orders', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      orderNum: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      uuid: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false
      }, 
      status: {
        type: DataTypes.INTEGER,
        allowNull: false
      }, 
      procurifyUserID: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      itemCount:{
        type: DataTypes.INTEGER,
        allowNull: false
      },
      totalPrice: {
        type: DataTypes.DECIMAL(10,2),
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
    });
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('Orders');
  }
};