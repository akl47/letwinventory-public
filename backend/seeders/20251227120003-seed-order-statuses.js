'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('OrderStatuses', [
      {
        name: 'Pending',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Placed',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Shipped',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Received',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('OrderStatuses', null, {});
  }
};
