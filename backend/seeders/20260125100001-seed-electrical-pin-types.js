'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();

    await queryInterface.bulkInsert('ElectricalPinTypes', [
      {
        name: 'Molex Mini-Fit Jr.',
        description: 'Molex Mini-Fit Jr. series connectors, commonly used for power connections. Available in 2-24 circuit configurations.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        name: 'JST-XH',
        description: 'JST XH series connectors, 2.5mm pitch. Commonly used for battery connections and general purpose wiring.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        name: '0.100 Pin Header',
        description: 'Standard 0.100" (2.54mm) pitch pin headers. Common for PCB connections and breadboard prototyping.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        name: 'Spade',
        description: 'Spade terminals (quick disconnect). Available in various sizes for different wire gauges.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        name: 'Screw Terminal',
        description: 'Screw terminal connectors for secure, tool-serviceable connections.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        name: 'Molex KK',
        description: 'Molex KK series connectors, 2.54mm pitch. Commonly used for signal connections.',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('ElectricalPinTypes', null, {});
  }
};
