'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Printers', [
      {
        name: '3x1 Label Printer',
        ipAddress: '10.50.20.91',
        description: '3x1 Label Printer',
        isDefault: true,
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: '1.5x1 Label Printer',
        ipAddress: '10.50.20.92',
        description: '1.5x1 Label Printer',
        isDefault: false,
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Printers', null, {});
  }
};
