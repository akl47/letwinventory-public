'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('UserGroups', [{
      name: 'Default',
      description: 'Default group for all new users',
      activeFlag: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('UserGroups', { name: 'Default' }, {});
  }
};
