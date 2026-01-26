'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    // Add cableDiagramImage column to HarnessCables table
    await queryInterface.addColumn('HarnessCables', 'cableDiagramImage', {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Base64 encoded cable diagram image'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('HarnessCables', 'cableDiagramImage');
  }
};
