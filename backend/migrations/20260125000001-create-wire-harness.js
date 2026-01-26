'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('WireHarnesses', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      partID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        }
      },
      revision: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'A'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      harnessData: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
      },
      thumbnailBase64: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      activeFlag: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdBy: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE
      }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('WireHarnesses');
  }
};
