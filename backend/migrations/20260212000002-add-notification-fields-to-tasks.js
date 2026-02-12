'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Tasks', 'reminderMinutes', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addColumn('Tasks', 'dueDateNotifiedAt', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Tasks', 'dueDateNotifiedAt');
    await queryInterface.removeColumn('Tasks', 'reminderMinutes');
  }
};
