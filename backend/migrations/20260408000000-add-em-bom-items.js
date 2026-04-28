'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = Sequelize.literal('NOW()');

    await queryInterface.createTable('EngineeringMasterBomItems', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      engineeringMasterID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'EngineeringMasters', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      partID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Parts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      quantity: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
      isTool: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('EngineeringMasterBomItems', ['engineeringMasterID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('EngineeringMasterBomItems');
  },
};
