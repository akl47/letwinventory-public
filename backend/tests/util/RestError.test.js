const RestError = require('../../util/RestError');

describe('RestError', () => {
  describe('constructor', () => {
    it('should create an error with message and status code', () => {
      const error = new RestError('Test error message', 400);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RestError);
      expect(error.message).toBe('Test error message');
      expect(error.statusCode).toBe(400);
    });

    it('should create a 500 error', () => {
      const error = new RestError('Internal server error', 500);

      expect(error.message).toBe('Internal server error');
      expect(error.statusCode).toBe(500);
    });

    it('should create a 401 unauthorized error', () => {
      const error = new RestError('Unauthorized', 401);

      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should create a 403 forbidden error', () => {
      const error = new RestError('Forbidden', 403);

      expect(error.message).toBe('Forbidden');
      expect(error.statusCode).toBe(403);
    });

    it('should create a 404 not found error', () => {
      const error = new RestError('Not found', 404);

      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
    });

    it('should have a stack trace', () => {
      const error = new RestError('Test error', 400);

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('RestError');
    });

    it('should work with try-catch', () => {
      expect(() => {
        throw new RestError('Thrown error', 422);
      }).toThrow(RestError);
    });

    it('should preserve error name', () => {
      const error = new RestError('Test', 400);
      expect(error.name).toBe('Error');
    });
  });
});
