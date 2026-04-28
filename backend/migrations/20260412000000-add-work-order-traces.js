'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add locationBarcodeID to WorkOrders
    await queryInterface.addColumn('WorkOrders', 'locationBarcodeID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Barcodes', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // Add workOrderID to Traces (links output traces to their WO)
    await queryInterface.addColumn('Traces', 'workOrderID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'WorkOrders', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('Traces', ['workOrderID']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Traces', 'workOrderID');
    await queryInterface.removeColumn('WorkOrders', 'locationBarcodeID');
  },
};
