'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if column already exists
    const tableDescription = await queryInterface.describeTable('Orders');

    if (!tableDescription.notes) {
      await queryInterface.addColumn('Orders', 'notes', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Check if column exists before trying to remove it
    const tableDescription = await queryInterface.describeTable('Orders');

    if (tableDescription.notes) {
      await queryInterface.removeColumn('Orders', 'notes');
    }
  }
};
