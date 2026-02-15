'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('RequirementHistory', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      requirementID: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'DesignRequirements',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      changedByUserID: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      changeType: {
        type: DataTypes.STRING(20),
        allowNull: false
      },
      changes: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      changeNotes: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE
      }
    });

    await queryInterface.addIndex('RequirementHistory', ['requirementID']);
    await queryInterface.addIndex('RequirementHistory', ['changedByUserID']);
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('RequirementHistory');
  }
};
