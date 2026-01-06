describe('bodyValidator middleware', () => {
  let bodyValidator;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    // Set up globals
    global.RestError = class RestError extends Error {
      constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
      }
    };

    // Mock database models
    global.db = {
      Location: {
        tableAttributes: {
          id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          name: { type: { constructor: { name: 'STRING' } }, allowNull: false },
          description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
          barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      },
      Box: {
        tableAttributes: {
          id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          name: { type: { constructor: { name: 'STRING' } }, allowNull: false },
          description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
          barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      },
      Trace: {
        tableAttributes: {
          id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          partID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          quantity: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          barcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
          parentBarcodeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
          activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      },
      Part: {
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
          partCategoryID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      },
      Order: {
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
          activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      },
      OrderItem: {
        tableAttributes: {
          id: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          orderID: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          partID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
          lineNumber: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          quantity: { type: { constructor: { name: 'INTEGER' } }, allowNull: false },
          price: { type: { constructor: { name: 'DECIMAL' } }, allowNull: true },
          description: { type: { constructor: { name: 'STRING' } }, allowNull: true },
          orderLineTypeID: { type: { constructor: { name: 'INTEGER' } }, allowNull: true },
          activeFlag: { type: { constructor: { name: 'BOOLEAN' } }, allowNull: false },
          createdAt: { type: { constructor: { name: 'DATE' } }, allowNull: false },
          updatedAt: { type: { constructor: { name: 'DATE' } }, allowNull: false }
        }
      }
    };

    jest.resetModules();
    bodyValidator = require('../../middleware/bodyValidator');

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.db;
    delete global.RestError;
  });

  describe('location validator', () => {
    it('should pass valid location data', () => {
      mockReq = {
        body: {
          name: 'Test Location'
        }
      };

      bodyValidator.location(mockReq, mockRes, mockNext);

      expect(mockReq.body.name).toBe('Test Location');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return error when name is missing', () => {
      mockReq = {
        body: {}
      };

      bodyValidator.location(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error).toBeInstanceOf(RestError);
      expect(error.statusCode).toBe(400);
    });

    it('should handle parentBarcodeID correctly', () => {
      mockReq = {
        body: {
          name: 'Test Location',
          parentBarcodeID: 5
        }
      };

      bodyValidator.location(mockReq, mockRes, mockNext);

      expect(mockReq.body.parentBarcodeID).toBe(5);
    });

    it('should handle null parentBarcodeID', () => {
      mockReq = {
        body: {
          name: 'Test Location',
          parentBarcodeID: null
        }
      };

      bodyValidator.location(mockReq, mockRes, mockNext);

      expect(mockReq.body.parentBarcodeID).toBe(0);
    });
  });

  describe('box validator', () => {
    it('should pass valid box data', () => {
      mockReq = {
        body: {
          name: 'Test Box'
        }
      };

      bodyValidator.box(mockReq, mockRes, mockNext);

      expect(mockReq.body.name).toBe('Test Box');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return error when name is missing', () => {
      mockReq = {
        body: {}
      };

      bodyValidator.box(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.statusCode).toBe(400);
    });
  });

  describe('trace validator', () => {
    it('should pass valid trace data', () => {
      mockReq = {
        body: {
          partID: 1,
          quantity: 10
        }
      };

      bodyValidator.trace(mockReq, mockRes, mockNext);

      expect(mockReq.body.partID).toBe(1);
      expect(mockReq.body.quantity).toBe(10);
    });

    it('should return error when partID is missing', () => {
      mockReq = {
        body: {
          quantity: 10
        }
      };

      bodyValidator.trace(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return error when quantity is missing', () => {
      mockReq = {
        body: {
          partID: 1
        }
      };

      bodyValidator.trace(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('part validator', () => {
    it('should pass valid part data', () => {
      mockReq = {
        body: {
          name: 'Test Part',
          internalPart: true,
          vendor: 'Test Vendor',
          minimumOrderQuantity: 5,
          partCategoryID: 1
        }
      };

      bodyValidator.part(mockReq, mockRes, mockNext);

      expect(mockReq.body.name).toBe('Test Part');
      expect(mockReq.body.internalPart).toBe(true);
      expect(mockReq.body.vendor).toBe('Test Vendor');
    });

    it('should return error when required fields are missing', () => {
      mockReq = {
        body: {
          name: 'Test Part'
        }
      };

      bodyValidator.part(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle optional description field', () => {
      mockReq = {
        body: {
          name: 'Test Part',
          description: 'A test part description',
          internalPart: false,
          vendor: 'Vendor',
          minimumOrderQuantity: 1,
          partCategoryID: 2
        }
      };

      bodyValidator.part(mockReq, mockRes, mockNext);

      expect(mockReq.body.description).toBe('A test part description');
    });
  });

  describe('order validator', () => {
    it('should pass valid order data', () => {
      mockReq = {
        body: {
          orderStatusID: 1,
          description: 'Test order'
        }
      };

      bodyValidator.order(mockReq, mockRes, mockNext);

      expect(mockReq.body.orderStatusID).toBe(1);
    });

    it('should handle optional fields', () => {
      mockReq = {
        body: {
          orderStatusID: 1,
          vendor: 'Test Vendor',
          trackingNumber: 'TRACK123',
          link: 'http://example.com',
          notes: 'Some notes',
          placedDate: '2024-01-01'
        }
      };

      bodyValidator.order(mockReq, mockRes, mockNext);

      expect(mockReq.body.vendor).toBe('Test Vendor');
      expect(mockReq.body.trackingNumber).toBe('TRACK123');
    });
  });

  describe('orderItem validator', () => {
    it('should pass valid order item data on POST', () => {
      mockReq = {
        method: 'POST',
        body: {
          orderID: 1,
          lineNumber: 1,
          quantity: 5
        }
      };

      bodyValidator.orderItem(mockReq, mockRes, mockNext);

      expect(mockReq.body.orderID).toBe(1);
      expect(mockReq.body.lineNumber).toBe(1);
      expect(mockReq.body.quantity).toBe(5);
    });

    it('should allow partial updates on PUT', () => {
      mockReq = {
        method: 'PUT',
        body: {
          quantity: 10
        }
      };

      bodyValidator.orderItem(mockReq, mockRes, mockNext);

      expect(mockReq.body.quantity).toBe(10);
    });

    it('should handle decimal price values', () => {
      mockReq = {
        method: 'POST',
        body: {
          orderID: 1,
          lineNumber: 1,
          quantity: 1,
          price: 19.99
        }
      };

      bodyValidator.orderItem(mockReq, mockRes, mockNext);

      expect(mockReq.body.price).toBe(19.99);
    });
  });
});
