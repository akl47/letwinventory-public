'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Parts', 'name', {
      type: Sequelize.STRING(32),
      allowNull: false,
      unique: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Parts', 'name', {
      type: Sequelize.STRING(16),
      allowNull: false,
      unique: true,
    });
  },
};
