'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ApiKeys', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      keyHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      userID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      lastUsedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('ApiKeys', ['userID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ApiKeys');
  }
};
