'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('UnitOfMeasures', 'allowDecimal', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    // Update continuous UoMs to allow decimals
    await queryInterface.bulkUpdate('UnitOfMeasures',
      { allowDecimal: true },
      { name: ['gal', 'g', 'kg', 'in', 'ft', 'm', 'mm'] }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('UnitOfMeasures', 'allowDecimal');
  }
};
