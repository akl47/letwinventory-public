'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add tagColorHex column to PartCategories
    await queryInterface.addColumn('PartCategories', 'tagColorHex', {
      type: Sequelize.STRING(7),
      allowNull: true,
      defaultValue: '#808080',
      comment: 'Hex color code for category tag display'
    });

    // Set default colors for existing categories and add new electrical part categories
    await queryInterface.sequelize.query(`
      -- Update existing categories with colors
      UPDATE "PartCategories" SET "tagColorHex" = '#1565c0' WHERE name = 'Part';
      UPDATE "PartCategories" SET "tagColorHex" = '#e65100' WHERE name = 'Consumable';
      UPDATE "PartCategories" SET "tagColorHex" = '#006064' WHERE name = 'Equipment';
      UPDATE "PartCategories" SET "tagColorHex" = '#6a1b9a' WHERE name = 'Tooling';

      -- Insert new electrical part categories (if they don't exist)
      INSERT INTO "PartCategories" (name, "activeFlag", "createdAt", "updatedAt", "tagColorHex")
      VALUES
        ('Harness', true, NOW(), NOW(), '#ff6f00'),
        ('Connector', true, NOW(), NOW(), '#c62828'),
        ('Cable', true, NOW(), NOW(), '#00838f'),
        ('Wire', true, NOW(), NOW(), '#4527a0'),
        ('Electrical Component', true, NOW(), NOW(), '#2e7d32')
      ON CONFLICT (name) DO UPDATE SET "tagColorHex" = EXCLUDED."tagColorHex";
    `);
  },

  async down(queryInterface, Sequelize) {
    // Remove the new categories
    await queryInterface.sequelize.query(`
      DELETE FROM "PartCategories"
      WHERE name IN ('Harness', 'Connector', 'Cable', 'Wire', 'Electrical Component');
    `);

    // Remove the tagColorHex column
    await queryInterface.removeColumn('PartCategories', 'tagColorHex');
  }
};
