const jwt = require('jsonwebtoken');

describe('checkToken middleware', () => {
  let checkToken;
  let mockReq;
  let mockRes;
  let mockNext;
  let mockUser;

  beforeEach(() => {
    // Set up globals
    global._ = require('lodash');
    global.RestError = class RestError extends Error {
      constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
      }
    };

    // Mock user data
    mockUser = {
      id: 1,
      displayName: 'Test User',
      email: 'test@example.com',
      dataValues: {
        id: 1,
        displayName: 'Test User',
        email: 'test@example.com'
      }
    };

    // Mock database
    global.db = {
      User: {
        findOne: jest.fn()
      }
    };

    // Set up JWT secret
    process.env.JWT_SECRET = 'test-secret-key';

    // Clear module cache and require fresh
    jest.resetModules();
    checkToken = require('../../middleware/checkToken');

    mockReq = {
      headers: {}
    };
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

  it('should return 400 error when authorization header is missing', () => {
    checkToken(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    const error = mockNext.mock.calls[0][0];
    expect(error.message).toBe('Request is missing in header.authorization');
    expect(error.statusCode).toBe(400);
  });

  it('should return 403 error when token is invalid', () => {
    mockReq.headers.authorization = 'Bearer invalid-token';

    checkToken(mockReq, mockRes, mockNext);

    // Wait for async operations
    setTimeout(() => {
      expect(mockNext).toHaveBeenCalled();
      const error = mockNext.mock.calls[0][0];
      expect(error.message).toBe('Invalid Token');
      expect(error.statusCode).toBe(403);
    }, 100);
  });

  it('should call next with user when token is valid', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    mockReq.headers.authorization = `Bearer ${token}`;

    global.db.User.findOne.mockResolvedValue(mockUser);

    checkToken(mockReq, mockRes, mockNext);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(global.db.User.findOne).toHaveBeenCalledWith({
      attributes: ['id', 'displayName', 'email'],
      where: {
        id: 1,
        activeFlag: true
      }
    });
  });

  it('should return 500 error when user is not found in database', async () => {
    const token = jwt.sign({ id: 999 }, process.env.JWT_SECRET);
    mockReq.headers.authorization = `Bearer ${token}`;

    global.db.User.findOne.mockResolvedValue(null);

    checkToken(mockReq, mockRes, mockNext);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalled();
    const error = mockNext.mock.calls[0][0];
    expect(error.message).toBe('Error finding user in database');
    expect(error.statusCode).toBe(500);
  });

  it('should return 500 error when database throws error', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    mockReq.headers.authorization = `Bearer ${token}`;

    global.db.User.findOne.mockRejectedValue(new Error('Database error'));

    checkToken(mockReq, mockRes, mockNext);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalled();
    const error = mockNext.mock.calls[0][0];
    expect(error.message).toBe('Error finding user in database');
    expect(error.statusCode).toBe(500);
  });

  it('should set req.user when authentication succeeds', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    mockReq.headers.authorization = `Bearer ${token}`;

    global.db.User.findOne.mockResolvedValue(mockUser);

    checkToken(mockReq, mockRes, mockNext);

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockReq.user).toEqual({
      id: 1,
      displayName: 'Test User',
      email: 'test@example.com'
    });
  });

  it('should handle authorization header without Bearer prefix', () => {
    mockReq.headers.authorization = 123; // Not a string

    checkToken(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    const error = mockNext.mock.calls[0][0];
    expect(error.statusCode).toBe(400);
  });
});
