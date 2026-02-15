'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('DesignRequirements', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      rationale: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      parameter: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      parentRequirementID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'DesignRequirements',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      projectID: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Projects',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      categoryID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'RequirementCategories',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      verification: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      validation: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      ownerUserID: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      approved: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      approvedByUserID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
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

    await queryInterface.addIndex('DesignRequirements', ['parentRequirementID']);
    await queryInterface.addIndex('DesignRequirements', ['ownerUserID']);
    await queryInterface.addIndex('DesignRequirements', ['projectID']);
    await queryInterface.addIndex('DesignRequirements', ['categoryID']);
    await queryInterface.addIndex('DesignRequirements', ['activeFlag']);
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('DesignRequirements');
  }
};
