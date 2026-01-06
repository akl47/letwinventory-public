const createError = require('http-errors');

describe('Order Controller', () => {
  let orderController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    global.db = {
      Order: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      OrderStatus: {},
      OrderItem: {},
      Part: {},
      OrderLineType: {}
    };

    jest.resetModules();
    orderController = require('../../../api/inventory/order/controller');

    mockReq = {
      body: {},
      params: {}
    };
    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.db;
  });

  describe('getAllOrders', () => {
    it('should return all orders with related data', async () => {
      const mockOrders = [
        { id: 1, description: 'Order 1', vendor: 'Vendor A' },
        { id: 2, description: 'Order 2', vendor: 'Vendor B' }
      ];

      global.db.Order.findAll.mockResolvedValue(mockOrders);

      await orderController.getAllOrders(mockReq, mockRes, mockNext);

      expect(global.db.Order.findAll).toHaveBeenCalledWith({
        order: [['id', 'DESC']],
        include: expect.arrayContaining([
          expect.objectContaining({
            model: global.db.OrderStatus,
            attributes: ['id', 'name', 'tagColor', 'nextStatusID']
          })
        ])
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockOrders);
    });

    it('should call next with error when database fails', async () => {
      global.db.Order.findAll.mockRejectedValue(new Error('Database error'));

      await orderController.getAllOrders(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.status).toBe(500);
    });
  });

  describe('getOrderById', () => {
    it('should return a single order by ID', async () => {
      const mockOrder = { id: 1, description: 'Test Order' };
      mockReq.params.id = '1';

      global.db.Order.findOne.mockResolvedValue(mockOrder);

      await orderController.getOrderById(mockReq, mockRes, mockNext);

      expect(global.db.Order.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' }
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockOrder);
    });

    it('should return 404 when order not found', async () => {
      mockReq.params.id = '999';
      global.db.Order.findOne.mockResolvedValue(null);

      await orderController.getOrderById(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.status).toBe(404);
    });

    it('should call next with error when database fails', async () => {
      mockReq.params.id = '1';
      global.db.Order.findOne.mockRejectedValue(new Error('Database error'));

      await orderController.getOrderById(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createNewOrder', () => {
    it('should create a new order', async () => {
      const newOrder = {
        id: 1,
        description: 'New Order',
        vendor: 'Test Vendor',
        orderStatusID: 1
      };

      mockReq.body = {
        description: 'New Order',
        vendor: 'Test Vendor',
        orderStatusID: 1
      };

      global.db.Order.create.mockResolvedValue(newOrder);

      await orderController.createNewOrder(mockReq, mockRes, mockNext);

      expect(global.db.Order.create).toHaveBeenCalledWith({
        description: 'New Order',
        vendor: 'Test Vendor',
        trackingNumber: undefined,
        link: undefined,
        notes: undefined,
        placedDate: undefined,
        receivedDate: undefined,
        orderStatusID: 1
      });
      expect(mockRes.json).toHaveBeenCalledWith(newOrder);
    });

    it('should create order with all optional fields', async () => {
      mockReq.body = {
        description: 'Full Order',
        vendor: 'Vendor',
        trackingNumber: 'TRACK123',
        link: 'http://example.com',
        notes: 'Some notes',
        placedDate: '2024-01-01',
        receivedDate: '2024-01-05',
        orderStatusID: 2
      };

      const createdOrder = { id: 1, ...mockReq.body };
      global.db.Order.create.mockResolvedValue(createdOrder);

      await orderController.createNewOrder(mockReq, mockRes, mockNext);

      expect(global.db.Order.create).toHaveBeenCalledWith(mockReq.body);
    });

    it('should call next with error when creation fails', async () => {
      mockReq.body = { description: 'Test Order' };
      global.db.Order.create.mockRejectedValue(new Error('Creation error'));

      await orderController.createNewOrder(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('updateOrderByID', () => {
    it('should update an order by ID', async () => {
      const updatedOrder = { id: 1, description: 'Updated Order' };
      mockReq.params.id = '1';
      mockReq.body = { description: 'Updated Order' };

      global.db.Order.update.mockResolvedValue([1, [updatedOrder]]);

      await orderController.updateOrderByID(mockReq, mockRes, mockNext);

      expect(global.db.Order.update).toHaveBeenCalledWith(mockReq.body, {
        where: { id: '1' },
        returning: true
      });
      expect(mockRes.json).toHaveBeenCalledWith([updatedOrder]);
    });

    it('should call next with error when update fails', async () => {
      mockReq.params.id = '1';
      mockReq.body = { description: 'Updated Order' };
      global.db.Order.update.mockRejectedValue(new Error('Update error'));

      await orderController.updateOrderByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('deleteOrderByID', () => {
    it('should soft delete an order', async () => {
      const mockOrder = {
        id: 1,
        description: 'Order to delete',
        activeFlag: true,
        toJSON: () => ({ id: 1, description: 'Order to delete', activeFlag: true })
      };

      mockReq.params.id = '1';
      global.db.Order.findOne.mockResolvedValue(mockOrder);
      global.db.Order.update.mockResolvedValue([1]);

      await orderController.deleteOrderByID(mockReq, mockRes, mockNext);

      expect(global.db.Order.findOne).toHaveBeenCalledWith({
        where: { id: '1', activeFlag: true }
      });
      expect(global.db.Order.update).toHaveBeenCalledWith(
        expect.objectContaining({ activeFlag: false }),
        { where: { id: '1', activeFlag: true } }
      );
    });

    it('should return 404 when order not found', async () => {
      mockReq.params.id = '999';
      global.db.Order.findOne.mockResolvedValue(null);

      await orderController.deleteOrderByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.status).toBe(404);
    });
  });
});
