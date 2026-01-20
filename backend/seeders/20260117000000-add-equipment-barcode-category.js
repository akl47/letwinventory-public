'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('BarcodeCategories', [
      {
        name: 'Equipment',
        tableName: 'Equipment',
        prefix: 'EQP',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('BarcodeCategories', { prefix: 'EQP' }, {});
  }
};
