const express = require('express');
const router = express.Router();
const controller = require('./controller');

// POST /api/auth/addon/token - Exchange Google ID token for Letwinventory JWT
router.post('/token', controller.exchangeToken);

module.exports = router;
