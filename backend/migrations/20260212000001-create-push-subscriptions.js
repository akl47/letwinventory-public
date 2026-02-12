'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PushSubscriptions', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      userID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      endpoint: {
        type: Sequelize.TEXT,
        allowNull: false,
        unique: true
      },
      p256dh: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      auth: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      userAgent: {
        type: Sequelize.STRING(255),
        allowNull: true
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

    await queryInterface.addIndex('PushSubscriptions', ['userID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PushSubscriptions');
  }
};
