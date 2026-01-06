const jwt = require('jsonwebtoken');

describe('User Controller', () => {
  let userController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key';

    global.db = {
      User: {
        findOne: jest.fn(),
        update: jest.fn()
      }
    };

    global.RestError = class RestError extends Error {
      constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
      }
    };

    jest.resetModules();
    userController = require('../../../api/auth/user/controller');

    mockReq = {
      headers: {},
      body: {},
      user: {}
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
    delete global.RestError;
    delete process.env.JWT_SECRET;
  });

  describe('checkToken', () => {
    it('should return 401 when no token provided', async () => {
      mockReq.headers = {};

      await userController.checkToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'No token provided' });
    });

    it('should return valid user when token is valid', async () => {
      const mockUser = {
        id: 1,
        displayName: 'Test User',
        email: 'test@example.com'
      };

      const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;

      global.db.User.findOne.mockResolvedValue(mockUser);

      await userController.checkToken(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        valid: true,
        user: {
          id: 1,
          displayName: 'Test User',
          email: 'test@example.com'
        }
      });
    });

    it('should return 401 when user not found', async () => {
      const token = jwt.sign({ id: 999 }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;

      global.db.User.findOne.mockResolvedValue(null);

      await userController.checkToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should return 401 when token is invalid', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      await userController.checkToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        valid: false,
        error: 'Invalid token'
      });
    });

    it('should return 401 when token is expired', async () => {
      const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1h' });
      mockReq.headers.authorization = `Bearer ${token}`;

      await userController.checkToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('getUser', () => {
    it('should return the current user', () => {
      mockReq.user = {
        id: 1,
        displayName: 'Test User',
        email: 'test@example.com'
      };

      userController.getUser(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(mockReq.user);
    });
  });

  describe('updateUser', () => {
    it('should update user displayName', async () => {
      const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      mockReq.body = { displayName: 'New Display Name' };

      const updatedUser = {
        id: 1,
        displayName: 'New Display Name',
        email: 'test@example.com'
      };

      global.db.User.update.mockResolvedValue([1]);
      global.db.User.findOne.mockResolvedValue(updatedUser);

      await userController.updateUser(mockReq, mockRes, mockNext);

      expect(global.db.User.update).toHaveBeenCalledWith(
        { displayName: 'New Display Name' },
        expect.objectContaining({
          where: {
            id: 1,
            activeFlag: true
          }
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        valid: true,
        user: {
          id: 1,
          displayName: 'New Display Name',
          email: 'test@example.com'
        }
      });
    });

    it('should return 404 when user not found for update', async () => {
      const token = jwt.sign({ id: 999 }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      mockReq.body = { displayName: 'New Name' };

      global.db.User.update.mockResolvedValue([0]);

      await userController.updateUser(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 500 when update fails', async () => {
      const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      mockReq.body = { displayName: 'New Name' };

      global.db.User.update.mockRejectedValue(new Error('Update failed'));

      await userController.updateUser(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
