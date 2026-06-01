'use strict';

// SolidWorks-style equations support (REQ 634/635). One JSONB column on
// DesignCADModels holding the equations document; existing rows default
// to an empty doc. No history-table change — DesignCADModelHistory's
// previousState/newState JSONB blobs pick up the new field automatically.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'DesignCADModels',
        'equations',
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: { entries: {} },
        },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('DesignCADModels', 'equations', { transaction });
    });
  },
};
