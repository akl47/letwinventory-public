'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add Kit and Assembly part categories
    await queryInterface.bulkInsert('PartCategories', [
      { name: 'Kit', tagColorHex: '#4CAF50', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'Assembly', tagColorHex: '#2196F3', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    ], { ignoreDuplicates: true });

    // 2. Add KITTED and UNKITTED barcode history action types
    await queryInterface.bulkInsert('BarcodeHistoryActionTypes', [
      { id: 8, code: 'KITTED', label: 'Kitted to Assembly', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 9, code: 'UNKITTED', label: 'Unkitted from Assembly', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    ], { ignoreDuplicates: true });

    // 3. Create BillOfMaterialItems table
    await queryInterface.createTable('BillOfMaterialItems', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      componentPartID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      quantity: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // 4. Add unique index on (partID, componentPartID) for active items
    await queryInterface.addIndex('BillOfMaterialItems', ['partID', 'componentPartID'], {
      unique: true,
      name: 'bom_part_component_unique',
      where: { activeFlag: true }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('BillOfMaterialItems');
    await queryInterface.bulkDelete('BarcodeHistoryActionTypes', { code: ['KITTED', 'UNKITTED'] });
    await queryInterface.bulkDelete('PartCategories', { name: ['Kit', 'Assembly'] });
  }
};
