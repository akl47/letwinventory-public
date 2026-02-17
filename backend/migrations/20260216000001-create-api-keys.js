'use strict';

/**
 * Creates API key tables:
 *   - ApiKeys (with expiresAt)
 *   - ApiKeyPermissions (junction table for scoped key permissions)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ApiKeys', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      keyHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      userID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      expiresAt: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      activeFlag: { type: Sequelize.BOOLEAN, defaultValue: true, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('ApiKeys', ['userID']);

    await queryInterface.createTable('ApiKeyPermissions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      apiKeyID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'ApiKeys', key: 'id' }, onDelete: 'CASCADE' },
      permissionID: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Permissions', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('ApiKeyPermissions', ['apiKeyID', 'permissionID'], { unique: true });
    await queryInterface.addIndex('ApiKeyPermissions', ['permissionID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ApiKeyPermissions');
    await queryInterface.dropTable('ApiKeys');
  }
};
