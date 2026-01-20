'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Equipment', 'orderItemID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'OrderItems',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Equipment', 'orderItemID');
  }
};
