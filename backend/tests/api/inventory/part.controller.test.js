const createError = require('http-errors');

describe('Part Controller', () => {
  let partController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    // Set up mock database
    global.db = {
      Part: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      Trace: {},
      PartCategory: {}
    };

    jest.resetModules();
    partController = require('../../../api/inventory/part/controller');

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

  describe('getAllParts', () => {
    it('should return all parts with traces and categories', async () => {
      const mockParts = [
        { id: 1, name: 'Part 1', vendor: 'Vendor A' },
        { id: 2, name: 'Part 2', vendor: 'Vendor B' }
      ];

      global.db.Part.findAll.mockResolvedValue(mockParts);

      await partController.getAllParts(mockReq, mockRes, mockNext);

      expect(global.db.Part.findAll).toHaveBeenCalledWith({
        order: [['name', 'asc']],
        include: [
          {
            model: global.db.Trace,
            where: { activeFlag: true },
            required: false
          },
          {
            model: global.db.PartCategory,
            attributes: ['id', 'name']
          }
        ]
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockParts);
    });

    it('should call next with error when database fails', async () => {
      global.db.Part.findAll.mockRejectedValue(new Error('Database error'));

      await partController.getAllParts(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.status).toBe(500);
    });
  });

  describe('createNewPart', () => {
    it('should create a new part', async () => {
      const newPart = {
        id: 1,
        name: 'New Part',
        vendor: 'Test Vendor',
        internalPart: true,
        minimumOrderQuantity: 5,
        partCategoryID: 1
      };

      mockReq.body = {
        name: 'New Part',
        vendor: 'Test Vendor',
        internalPart: true,
        minimumOrderQuantity: 5,
        partCategoryID: 1
      };

      global.db.Part.create.mockResolvedValue(newPart);

      await partController.createNewPart(mockReq, mockRes, mockNext);

      expect(global.db.Part.create).toHaveBeenCalledWith(mockReq.body);
      expect(mockRes.json).toHaveBeenCalledWith(newPart);
    });

    it('should call next with error when creation fails', async () => {
      mockReq.body = { name: 'Test Part' };
      global.db.Part.create.mockRejectedValue(new Error('Validation error'));

      await partController.createNewPart(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.status).toBe(500);
    });
  });

  describe('updatePartByID', () => {
    it('should update a part by ID', async () => {
      const updatedPart = { id: 1, name: 'Updated Part' };
      mockReq.params.id = '1';
      mockReq.body = { name: 'Updated Part' };

      global.db.Part.update.mockResolvedValue([1, [updatedPart]]);

      await partController.updatePartByID(mockReq, mockRes, mockNext);

      expect(global.db.Part.update).toHaveBeenCalledWith(mockReq.body, {
        where: { id: '1' },
        returning: true
      });
      expect(mockRes.json).toHaveBeenCalledWith([updatedPart]);
    });

    it('should call next with error when update fails', async () => {
      mockReq.params.id = '1';
      mockReq.body = { name: 'Updated Part' };
      global.db.Part.update.mockRejectedValue(new Error('Update error'));

      await partController.updatePartByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('deletePartByID', () => {
    it('should soft delete a part by setting activeFlag to false', async () => {
      const mockPart = {
        id: 1,
        name: 'Part to delete',
        activeFlag: true,
        toJSON: () => ({ id: 1, name: 'Part to delete', activeFlag: true })
      };

      mockReq.params.id = '1';
      global.db.Part.findOne.mockResolvedValue(mockPart);
      global.db.Part.update.mockResolvedValue([1]);

      await partController.deletePartByID(mockReq, mockRes, mockNext);

      expect(global.db.Part.findOne).toHaveBeenCalledWith({
        where: { id: '1', activeFlag: true }
      });
      expect(global.db.Part.update).toHaveBeenCalledWith(
        expect.objectContaining({ activeFlag: false }),
        { where: { id: '1', activeFlag: true } }
      );
    });

    it('should call next with error when part not found', async () => {
      mockReq.params.id = '999';
      global.db.Part.findOne.mockRejectedValue(new Error('Not found'));

      await partController.deletePartByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
