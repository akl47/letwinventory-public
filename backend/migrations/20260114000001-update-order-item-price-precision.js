'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Change the price column to support 5 decimal places
    await queryInterface.changeColumn('OrderItems', 'price', {
      type: Sequelize.DECIMAL(10, 5),
      allowNull: false,
      defaultValue: 0.00
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert back to 2 decimal places
    await queryInterface.changeColumn('OrderItems', 'price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    });
  }
};
