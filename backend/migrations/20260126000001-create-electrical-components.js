'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('ElectricalComponents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      label: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      pinCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      pins: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      pinoutDiagramImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Base64 encoded pinout diagram image'
      },
      componentImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Base64 encoded component image'
      },
      partID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      activeFlag: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
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

    // Add indexes for faster queries
    await queryInterface.addIndex('ElectricalComponents', ['partID']);
    await queryInterface.addIndex('ElectricalComponents', ['activeFlag']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ElectricalComponents');
  }
};
