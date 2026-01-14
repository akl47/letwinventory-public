'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Printers', [
      {
        name: 'Default Printer',
        ipAddress: '10.10.10.37',
        description: 'Main warehouse printer',
        isDefault: true,
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Printer 2',
        ipAddress: '10.10.10.38',
        description: 'Secondary warehouse printer',
        isDefault: false,
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Printer 3',
        ipAddress: '10.10.10.39',
        description: 'Office printer',
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
