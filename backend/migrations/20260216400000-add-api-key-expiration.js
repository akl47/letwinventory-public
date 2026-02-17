'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ApiKeys', 'expiresAt', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ApiKeys', 'expiresAt');
  }
};
