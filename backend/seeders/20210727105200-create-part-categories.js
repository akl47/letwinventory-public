'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('PartCategories', [
      {
        name: 'Part',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Consumable',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Tooling',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('PartCategories', null, {});
  }
};
