'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    // Create HarnessConnectors table
    await queryInterface.createTable('HarnessConnectors', {
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
      type: {
        type: DataTypes.ENUM('male', 'female', 'terminal', 'splice'),
        allowNull: false
      },
      pinCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      color: {
        type: DataTypes.STRING(10),
        allowNull: true
      },
      pins: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
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

    // Create HarnessWires table
    await queryInterface.createTable('HarnessWires', {
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
      color: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      colorCode: {
        type: DataTypes.STRING(10),
        allowNull: true
      },
      gaugeAWG: {
        type: DataTypes.STRING(10),
        allowNull: true
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

    // Create HarnessCables table
    await queryInterface.createTable('HarnessCables', {
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
      wireCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      gaugeAWG: {
        type: DataTypes.STRING(10),
        allowNull: true
      },
      wires: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
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
    await queryInterface.addIndex('HarnessConnectors', ['partID']);
    await queryInterface.addIndex('HarnessConnectors', ['activeFlag']);
    await queryInterface.addIndex('HarnessWires', ['partID']);
    await queryInterface.addIndex('HarnessWires', ['activeFlag']);
    await queryInterface.addIndex('HarnessCables', ['partID']);
    await queryInterface.addIndex('HarnessCables', ['activeFlag']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('HarnessCables');
    await queryInterface.dropTable('HarnessWires');
    await queryInterface.dropTable('HarnessConnectors');
  }
};
