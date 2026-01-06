describe('errorHandler', () => {
  let errorHandler;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    // Set up global lodash mock
    global._ = require('lodash');

    errorHandler = require('../../util/errorHandler');

    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return error with provided status code', () => {
    const error = {
      message: 'Bad request',
      statusCode: 400
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      errorMessage: 'Bad request'
    });
  });

  it('should default to 500 status code when statusCode is not a number', () => {
    const error = {
      message: 'Unknown error',
      statusCode: 'not a number'
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      errorMessage: 'Unknown error'
    });
  });

  it('should default to 500 status code when statusCode is undefined', () => {
    const error = {
      message: 'Server error'
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      errorMessage: 'Server error'
    });
  });

  it('should handle 401 unauthorized errors', () => {
    const error = {
      message: 'Unauthorized access',
      statusCode: 401
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      errorMessage: 'Unauthorized access'
    });
  });

  it('should handle 403 forbidden errors', () => {
    const error = {
      message: 'Forbidden',
      statusCode: 403
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it('should handle 404 not found errors', () => {
    const error = {
      message: 'Resource not found',
      statusCode: 404
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      errorMessage: 'Resource not found'
    });
  });

  it('should handle null statusCode', () => {
    const error = {
      message: 'Null status error',
      statusCode: null
    };

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });
});
