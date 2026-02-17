'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ApiKeyPermissions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      apiKeyID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ApiKeys', key: 'id' },
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

    await queryInterface.addIndex('ApiKeyPermissions', ['apiKeyID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('ApiKeyPermissions', ['permissionID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ApiKeyPermissions');
  }
};
