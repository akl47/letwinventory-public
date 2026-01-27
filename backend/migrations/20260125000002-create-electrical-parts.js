'use strict';

module.exports = {
  up: async (queryInterface, DataTypes) => {
    // Create ElectricalPinTypes table first (referenced by ElectricalConnectors)
    await queryInterface.createTable('ElectricalPinTypes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
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

    // Create ElectricalConnectors table
    await queryInterface.createTable('ElectricalConnectors', {
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
      pinoutDiagramImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Base64 encoded pinout diagram image'
      },
      connectorImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Base64 encoded connector image'
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
      electricalPinTypeID: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'ElectricalPinTypes',
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

    // Create Wires table
    await queryInterface.createTable('Wires', {
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

    // Create Cables table
    await queryInterface.createTable('Cables', {
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
      cableDiagramImage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Base64 encoded cable diagram image'
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
    await queryInterface.addIndex('ElectricalConnectors', ['partID']);
    await queryInterface.addIndex('ElectricalConnectors', ['electricalPinTypeID']);
    await queryInterface.addIndex('ElectricalConnectors', ['activeFlag']);
    await queryInterface.addIndex('Wires', ['partID']);
    await queryInterface.addIndex('Wires', ['activeFlag']);
    await queryInterface.addIndex('Cables', ['partID']);
    await queryInterface.addIndex('Cables', ['activeFlag']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Cables');
    await queryInterface.dropTable('Wires');
    await queryInterface.dropTable('ElectricalConnectors');
    await queryInterface.dropTable('ElectricalPinTypes');
  }
};
