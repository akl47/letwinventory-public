'use strict';

const path = require('path');
const db = require('../../models');
const { UploadedFile } = db;
const fileStorage = require('../../util/fileStorage');

// Get all files
const getFiles = async (req, res) => {
  try {
    const { activeOnly = 'true' } = req.query;

    const where = {};
    if (activeOnly === 'true') {
      where.activeFlag = true;
    }

    const files = await UploadedFile.findAll({
      where,
      attributes: ['id', 'filename', 'mimeType', 'fileSize', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']]
    });

    res.json(files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
};

// Get a single file by ID
const getFileById = async (req, res) => {
  try {
    const { id } = req.params;

    const attributes = ['id', 'filename', 'mimeType', 'fileSize', 'filePath', 'createdAt', 'updatedAt'];

    const file = await UploadedFile.findByPk(id, { attributes });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(file);
  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
};

// Get file data — streams binary from disk or falls back to base64 in DB
const getFileData = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await UploadedFile.findByPk(id, {
      attributes: ['id', 'mimeType', 'filename', 'filePath', 'data']
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Prefer disk file
    if (file.filePath && fileStorage.fileExists(file.filePath)) {
      const absPath = fileStorage.getAbsolutePath(file.filePath);
      res.set('Content-Type', file.mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Disposition', `inline; filename="${file.filename}"`);
      return res.sendFile(absPath);
    }

    // Fall back to base64 data in DB (legacy)
    if (file.data) {
      const buffer = fileStorage.decodeBase64(file.data);
      res.set('Content-Type', file.mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Disposition', `inline; filename="${file.filename}"`);
      return res.send(buffer);
    }

    res.status(404).json({ error: 'File data not available' });
  } catch (error) {
    console.error('Error fetching file data:', error);
    res.status(500).json({ error: 'Failed to fetch file data' });
  }
};

// Upload a new file — saves to disk
const uploadFile = async (req, res) => {
  try {
    const { filename, mimeType, data } = req.body;

    if (!filename || !mimeType || !data) {
      return res.status(400).json({ error: 'filename, mimeType, and data are required' });
    }

    const buffer = fileStorage.decodeBase64(data);
    const filePath = fileStorage.saveFile(buffer, mimeType, filename);

    const file = await UploadedFile.create({
      filename,
      mimeType,
      fileSize: buffer.length,
      filePath,
      data: null,
      uploadedBy: req.user?.id || null,
      activeFlag: true
    });

    res.status(201).json({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      createdAt: file.createdAt
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
};

// Update file metadata
const updateFile = async (req, res) => {
  try {
    const { id } = req.params;
    const { filename } = req.body;

    const file = await UploadedFile.findByPk(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    await file.update({
      filename: filename ?? file.filename
    });

    res.json({
      id: file.id,
      filename: file.filename,
      updatedAt: file.updatedAt
    });
  } catch (error) {
    console.error('Error updating file:', error);
    res.status(500).json({ error: 'Failed to update file' });
  }
};

// Soft delete a file
const deleteFile = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await UploadedFile.findByPk(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    await file.update({ activeFlag: false });

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
};


module.exports = {
  getFiles,
  getFileById,
  getFileData,
  uploadFile,
  updateFile,
  deleteFile
};
