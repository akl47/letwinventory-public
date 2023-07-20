'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('BarcodeCategories', [
      {
        name: 'Trace',
        tableName: 'Traces',
        prefix: 'NLK',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Location',
        tableName: 'Locations',
        prefix: 'LOC',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Box',
        tableName: 'Boxes',
        prefix: 'BOX',
        createdAt: new Date(),
        updatedAt: new Date()
      },

    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('BarcodeCategories', null, {});
  }
};
