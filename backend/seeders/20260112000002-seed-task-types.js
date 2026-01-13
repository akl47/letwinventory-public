'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('TaskTypes', [
      {
        value: 'normal',
        label: 'Normal',
        colorClass: 'label-blue',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        value: 'tracking',
        label: 'Tracking',
        colorClass: 'label-yellow',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        value: 'critical_path',
        label: 'Critical Path',
        colorClass: 'label-red',
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('TaskTypes', null, {});
  }
};
