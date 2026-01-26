'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('PartCategories', [
      {
        name: 'Connector',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Wire',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Cable',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Harness',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('PartCategories', {
      name: ['Connector', 'Wire', 'Cable', 'Harness']
    }, {});
  }
};
