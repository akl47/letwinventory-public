'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('OrderLineTypes', [
      {
        name: 'Part',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Shipping',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Taxes',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Services',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Other',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('OrderLineTypes', null, {});
  }
};
