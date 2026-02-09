'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ShipmentTrackings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      orderID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Orders',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      ownerUserID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      trackingNumber: {
        type: Sequelize.STRING,
        allowNull: false
      },
      carrier: {
        type: Sequelize.ENUM('usps', 'ups', 'fedex', 'dhl', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown'
      },
      status: {
        type: Sequelize.STRING,
        allowNull: true
      },
      statusDetail: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      estimatedDelivery: {
        type: Sequelize.DATE,
        allowNull: true
      },
      deliveredAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastCheckedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      trackingData: {
        type: Sequelize.JSON,
        allowNull: true
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('ShipmentTrackings', ['ownerUserID']);
    await queryInterface.addIndex('ShipmentTrackings', ['orderID']);
    await queryInterface.addIndex('ShipmentTrackings', ['activeFlag', 'status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('ShipmentTrackings');
  }
};
