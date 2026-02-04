'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RefreshTokens', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      token: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index on token for fast lookups
    await queryInterface.addIndex('RefreshTokens', ['token']);
    // Index on userId for cleanup queries
    await queryInterface.addIndex('RefreshTokens', ['userId']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('RefreshTokens');
  }
};
