module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/__tests__/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 15000,
};
