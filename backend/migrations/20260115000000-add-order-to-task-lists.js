'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('TaskLists', 'order', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });

    // Set initial order values based on existing createdAt order
    const [taskLists] = await queryInterface.sequelize.query(
      'SELECT id FROM "TaskLists" ORDER BY "createdAt" ASC'
    );

    for (let i = 0; i < taskLists.length; i++) {
      await queryInterface.sequelize.query(
        `UPDATE "TaskLists" SET "order" = ${i} WHERE id = ${taskLists[i].id}`
      );
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('TaskLists', 'order');
  }
};
