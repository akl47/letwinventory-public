'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Parts', 'minimumOrderQuantity', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Parts', 'minimumOrderQuantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },
};
