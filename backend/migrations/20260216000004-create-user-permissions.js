'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserPermissions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      userID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      permissionID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Permissions', key: 'id' },
        onDelete: 'CASCADE'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('UserPermissions', ['userID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('UserPermissions', ['permissionID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserPermissions');
  }
};
