'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {


    // Add the column with default value
    await queryInterface.addColumn('Parts', 'partCategoryID', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
      references: {
        model: 'PartCategories',
        key: 'id'
      },
      onDelete: 'CASCADE'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Parts', 'partCategoryID');
  }
};
