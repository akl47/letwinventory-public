'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./controller');
const checkToken = require('../../middleware/checkToken.js');

// GET /api/files/:id - Get file metadata by ID (no permission check — file IDs are opaque references)
router.get('/:id', checkToken, controller.getFileById);

// GET /api/files/:id/data - Get file data (for displaying images)
router.get('/:id/data', checkToken, controller.getFileData);

module.exports = router;
