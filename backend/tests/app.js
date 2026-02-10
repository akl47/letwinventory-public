// This file loads the Express app for testing.
// tests/setup.js must be loaded first (via Jest setupFilesAfterSetup)
// to initialize the test database and globals.
const app = require('../index');
module.exports = app;
