'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableDescription = await queryInterface.describeTable('Parts');

    // Add manufacturer column if it doesn't exist
    if (!tableDescription.manufacturer) {
      await queryInterface.addColumn('Parts', 'manufacturer', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }

    // Add manufacturerPN column if it doesn't exist
    if (!tableDescription.manufacturerPN) {
      await queryInterface.addColumn('Parts', 'manufacturerPN', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableDescription = await queryInterface.describeTable('Parts');

    // Remove manufacturerPN column if it exists
    if (tableDescription.manufacturerPN) {
      await queryInterface.removeColumn('Parts', 'manufacturerPN');
    }

    // Remove manufacturer column if it exists
    if (tableDescription.manufacturer) {
      await queryInterface.removeColumn('Parts', 'manufacturer');
    }
  }
};
