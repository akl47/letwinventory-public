// Test setup file
const path = require('path');

// Load environment variables for testing
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

// Set up global mocks
global.RestError = class RestError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

global._ = require('lodash');

// Mock console.log to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: console.error
};
