'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { User } = require('../models');
    const user = await User.findOne({ where: { email: 'alexanderletwin@gmail.com' }, attributes: ['id'], raw: true });

    if (!user) {
      console.log('User not found, skipping project seeding');
      return;
    }

    return queryInterface.bulkInsert('Projects', [
      {
        ownerUserID: user.id,
        parentProjectID: null,
        tagColorHex: 'ff0000',
        name: 'Letwinventory',
        shortName: 'Inv',
        description: null,
        activeFlag: true,
        createdAt: new Date('2026-01-06 23:24:23.652+00'),
        updatedAt: new Date('2026-01-06 23:24:23.652+00')
      },
      {
        ownerUserID: user.id,
        parentProjectID: null,
        tagColorHex: '007F00',
        name: 'Home',
        shortName: 'Home',
        description: null,
        activeFlag: true,
        createdAt: new Date('2026-01-13 04:17:33.710894+00'),
        updatedAt: new Date('2026-01-13 04:17:33.710894+00')
      },
      {
        ownerUserID: user.id,
        parentProjectID: null,
        tagColorHex: '00007f',
        name: 'Lab',
        shortName: 'Lab',
        description: null,
        activeFlag: true,
        createdAt: new Date('2026-01-13 04:18:18.980691+00'),
        updatedAt: new Date('2026-01-13 04:18:18.980691+00')
      },
      {
        ownerUserID: user.id,
        parentProjectID: null,
        tagColorHex: '7F00ff',
        name: 'Pinball',
        shortName: 'PB',
        description: null,
        activeFlag: true,
        createdAt: new Date('2026-01-13 04:20:39.325431+00'),
        updatedAt: new Date('2026-01-13 04:20:39.325431+00')
      },
      {
        ownerUserID: user.id,
        parentProjectID: null,
        tagColorHex: 'FF7f00',
        name: 'Workshop',
        shortName: 'Shop',
        description: null,
        activeFlag: true,
        createdAt: new Date('2026-01-13 04:22:31.900542+00'),
        updatedAt: new Date('2026-01-13 04:22:31.900542+00')
      }
    ]);
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Projects', {
      name: ['Letwinventory', 'Home', 'Lab', 'Pinball', 'Workshop']
    }, {});
  }
};
