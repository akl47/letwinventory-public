'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./controller');
const checkToken = require('../../middleware/checkToken.js');

// GET /api/files - Get all files (with optional category filter)
router.get('/', checkToken, controller.getFiles);

// GET /api/files/:id - Get file metadata by ID
router.get('/:id', checkToken, controller.getFileById);

// GET /api/files/:id/data - Get file data (for displaying images)
router.get('/:id/data', checkToken, controller.getFileData);

// POST /api/files - Upload a new file
router.post('/', checkToken, controller.uploadFile);

// PUT /api/files/:id - Update file metadata
router.put('/:id', checkToken, controller.updateFile);

// DELETE /api/files/:id - Soft delete a file
router.delete('/:id', checkToken, controller.deleteFile);

module.exports = router;
