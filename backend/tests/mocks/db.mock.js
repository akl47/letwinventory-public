// Mock database models for testing

const createMockModel = (modelName) => {
  return {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
    bulkCreate: jest.fn(),
    tableAttributes: {}
  };
};

const mockDb = {
  User: {
    ...createMockModel('User'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      googleID: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      displayName: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      email: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      photoURL: { type: { constructor: { name: 'TEXT' } }, allowNull: true },
      activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false }
    }
  },
  Part: {
    ...createMockModel('Part'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      name: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      internalPart: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
      vendor: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      sku: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      link: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
      minimumOrderQuantity: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      partCategoryID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false }
    }
  },
  PartCategory: createMockModel('PartCategory'),
  Order: {
    ...createMockModel('Order'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      description: { type: { constructor: { name: 'TEXT' } }, allowNull: true },
      vendor: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      trackingNumber: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      link: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      notes: { type: { constructor: { name: 'TEXT' } }, allowNull: true },
      placedDate: { type: { constructor: { name: 'DATE' } }, allowNull: true },
      receivedDate: { type: { constructor: { name: 'DATE' } }, allowNull: true },
      orderStatusID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false }
    }
  },
  OrderItem: {
    ...createMockModel('OrderItem'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      orderID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      partID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
      lineNumber: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      quantity: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      price: { type: { constructor: { name: 'DECIMAL' } }, allowNull: true },
      description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      orderLineTypeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
      activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false }
    }
  },
  OrderStatus: createMockModel('OrderStatus'),
  OrderLineType: createMockModel('OrderLineType'),
  Barcode: createMockModel('Barcode'),
  BarcodeCategory: createMockModel('BarcodeCategory'),
  Box: {
    ...createMockModel('Box'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      name: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false }
    }
  },
  Location: {
    ...createMockModel('Location'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      name: { type: { constructor: { name: 'STRING' } }, allowNull: false },
      description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
      barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false }
    }
  },
  Trace: {
    ...createMockModel('Trace'),
    tableAttributes: {
      id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      partID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      quantity: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
      barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
      parentBarcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
      activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false }
    }
  },
  Project: createMockModel('Project'),
  Task: createMockModel('Task'),
  TaskList: createMockModel('TaskList'),
  TaskHistory: createMockModel('TaskHistory'),
  sequelize: {
    sync: jest.fn().mockResolvedValue(true),
    authenticate: jest.fn().mockResolvedValue(true),
    transaction: jest.fn().mockImplementation(callback => callback({ commit: jest.fn(), rollback: jest.fn() }))
  },
  Sequelize: {
    Op: {
      eq: Symbol('eq'),
      ne: Symbol('ne'),
      gt: Symbol('gt'),
      gte: Symbol('gte'),
      lt: Symbol('lt'),
      lte: Symbol('lte'),
      like: Symbol('like'),
      in: Symbol('in'),
      notIn: Symbol('notIn'),
      and: Symbol('and'),
      or: Symbol('or')
    }
  }
};

module.exports = mockDb;
