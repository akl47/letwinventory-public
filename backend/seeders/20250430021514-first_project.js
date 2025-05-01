'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { User } = require('../models');
    const user = await User.findOne({ where: { email: 'alexanderletwin@gmail.com' }, attributes: ['id'], raw: true });
    
    return queryInterface.bulkInsert('Projects', [
      {
        ownerUserID: user.id,
        tagColorHex: "ff0000",
        name: "letwinventory",
        shortName: "INV",
      }
    ]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Projects', null, {});
  }
};