'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    // Add pinoutDiagramImage column
    await queryInterface.addColumn('HarnessConnectors', 'pinoutDiagramImage', {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded pinout diagram image'
    });

    // Add connectorImage column
    await queryInterface.addColumn('HarnessConnectors', 'connectorImage', {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded connector image'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('HarnessConnectors', 'pinoutDiagramImage');
    await queryInterface.removeColumn('HarnessConnectors', 'connectorImage');
  }
};
