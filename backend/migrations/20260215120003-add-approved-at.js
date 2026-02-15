'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.addColumn('DesignRequirements', 'approvedAt', {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('DesignRequirements', 'approvedAt');
  }
};
