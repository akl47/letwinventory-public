'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('GroupPermissions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      groupID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'UserGroups', key: 'id' },
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

    await queryInterface.addIndex('GroupPermissions', ['groupID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('GroupPermissions', ['permissionID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('GroupPermissions');
  }
};
