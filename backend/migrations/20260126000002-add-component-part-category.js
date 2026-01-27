'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add Component to PartCategories
    await queryInterface.sequelize.query(`
      INSERT INTO "PartCategories" (name, "activeFlag", "createdAt", "updatedAt", "tagColorHex")
      VALUES ('Electrical Component', true, NOW(), NOW(), '#2e7d32')
      ON CONFLICT (name) DO NOTHING;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DELETE FROM "PartCategories" WHERE name = 'Electrical Component';
    `);
  }
};
