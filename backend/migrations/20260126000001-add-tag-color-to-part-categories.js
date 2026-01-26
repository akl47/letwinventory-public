'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if column already exists
    const tableDescription = await queryInterface.describeTable('PartCategories');

    if (!tableDescription.tagColorHex) {
      await queryInterface.addColumn('PartCategories', 'tagColorHex', {
        type: Sequelize.STRING(7),
        allowNull: true,
        defaultValue: '#808080'
      });

      // Set default colors for existing categories
      await queryInterface.sequelize.query(`
        UPDATE "PartCategories" SET "tagColorHex" = '#1565c0' WHERE name = 'Part';
        UPDATE "PartCategories" SET "tagColorHex" = '#e65100' WHERE name = 'Consumable';
        UPDATE "PartCategories" SET "tagColorHex" = '#006064' WHERE name = 'Equipment';
        UPDATE "PartCategories" SET "tagColorHex" = '#6a1b9a' WHERE name = 'Tooling';
        UPDATE "PartCategories" SET "tagColorHex" = '#2e7d32' WHERE name = 'Harness';
        UPDATE "PartCategories" SET "tagColorHex" = '#c62828' WHERE name = 'Connector';
        UPDATE "PartCategories" SET "tagColorHex" = '#00838f' WHERE name = 'Cable';
        UPDATE "PartCategories" SET "tagColorHex" = '#4527a0' WHERE name = 'Wire';
      `);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableDescription = await queryInterface.describeTable('PartCategories');

    if (tableDescription.tagColorHex) {
      await queryInterface.removeColumn('PartCategories', 'tagColorHex');
    }
  }
};
