'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DesignRequirements', 'implementationStatus', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'not_implemented'
    });
    await queryInterface.addColumn('DesignRequirements', 'implementedByUserID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    });
    await queryInterface.addColumn('DesignRequirements', 'implementedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('DesignRequirements', 'implementedAt');
    await queryInterface.removeColumn('DesignRequirements', 'implementedByUserID');
    await queryInterface.removeColumn('DesignRequirements', 'implementationStatus');
  }
};
