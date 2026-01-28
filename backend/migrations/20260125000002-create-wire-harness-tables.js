'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WireHarnesses', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      revision: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'A'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      harnessData: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'JSON structure containing connectors, cables, wires, and connections'
      },
      thumbnailBase64: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Base64 encoded thumbnail image'
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdBy: {
        type: Sequelize.STRING(100),
        allowNull: true
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

    await queryInterface.addIndex('WireHarnesses', ['partID']);
    await queryInterface.addIndex('WireHarnesses', ['activeFlag']);

    // =========================================
    // 2. Create ElectricalPinTypes table
    // =========================================
    await queryInterface.createTable('ElectricalPinTypes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
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

    // =========================================
    // 3. Create ElectricalConnectors table
    // =========================================
    await queryInterface.createTable('ElectricalConnectors', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      label: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Connector label (e.g., J1, P2, CN1)'
      },
      type: {
        type: Sequelize.ENUM('male', 'female', 'terminal', 'splice'),
        allowNull: false
      },
      pinCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      color: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'Color code (e.g., GY, BK, RD)'
      },
      pins: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of pin definitions [{id, number, label}]'
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Link to inventory Part'
      },
      electricalPinTypeID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'ElectricalPinTypes',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      pinoutDiagramFileID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'UploadedFiles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Reference to pinout diagram in UploadedFiles'
      },
      connectorImageFileID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'UploadedFiles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Reference to connector image in UploadedFiles'
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

    await queryInterface.addIndex('ElectricalConnectors', ['partID']);
    await queryInterface.addIndex('ElectricalConnectors', ['electricalPinTypeID']);
    await queryInterface.addIndex('ElectricalConnectors', ['activeFlag']);

    // =========================================
    // 4. Create Wires table
    // =========================================
    await queryInterface.createTable('Wires', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      label: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      color: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Wire color name'
      },
      colorCode: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'Standard color code (e.g., BK, RD, BU)'
      },
      gaugeAWG: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'Wire gauge (e.g., 18 AWG, 22 AWG)'
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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

    await queryInterface.addIndex('Wires', ['partID']);
    await queryInterface.addIndex('Wires', ['activeFlag']);

    // =========================================
    // 5. Create Cables table
    // =========================================
    await queryInterface.createTable('Cables', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      label: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Cable label (e.g., CABLE-A)'
      },
      wireCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      gaugeAWG: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'Wire gauge for all wires in cable'
      },
      wires: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of wire definitions [{id, color, colorCode}]'
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Link to inventory Part'
      },
      cableDiagramFileID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'UploadedFiles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Reference to cable diagram in UploadedFiles'
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

    await queryInterface.addIndex('Cables', ['partID']);
    await queryInterface.addIndex('Cables', ['activeFlag']);

    // =========================================
    // 6. Create ElectricalComponents table
    // =========================================
    await queryInterface.createTable('ElectricalComponents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      label: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Component label/reference designator (e.g., U1, R2, C3)'
      },
      pinCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      pins: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of pin groups [{id, name, pinTypeID, pins: [{id, number, label}]}]'
      },
      partID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Parts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Link to inventory Part'
      },
      pinoutDiagramFileID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'UploadedFiles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Reference to pinout diagram in UploadedFiles'
      },
      componentImageFileID: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'UploadedFiles',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Reference to component image in UploadedFiles'
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

    await queryInterface.addIndex('ElectricalComponents', ['partID']);
    await queryInterface.addIndex('ElectricalComponents', ['activeFlag']);
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order of creation (due to foreign key constraints)
    await queryInterface.dropTable('ElectricalComponents');
    await queryInterface.dropTable('Cables');
    await queryInterface.dropTable('Wires');
    await queryInterface.dropTable('ElectricalConnectors');
    await queryInterface.dropTable('ElectricalPinTypes');
    await queryInterface.dropTable('WireHarnesses');
  }
};
