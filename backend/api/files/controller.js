'use strict';

const db = require('../../models');
const { UploadedFile } = db;

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
    const { includeData = 'false' } = req.query;

    const attributes = ['id', 'filename', 'mimeType', 'fileSize', 'createdAt', 'updatedAt'];
    if (includeData === 'true') {
      attributes.push('data');
    }

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

// Get file data (for displaying images)
const getFileData = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await UploadedFile.findByPk(id, {
      attributes: ['data', 'mimeType', 'filename']
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Return the base64 data with proper content type
    res.json({
      data: file.data,
      mimeType: file.mimeType,
      filename: file.filename
    });
  } catch (error) {
    console.error('Error fetching file data:', error);
    res.status(500).json({ error: 'Failed to fetch file data' });
  }
};

// Upload a new file
const uploadFile = async (req, res) => {
  try {
    const { filename, mimeType, data } = req.body;

    if (!filename || !mimeType || !data) {
      return res.status(400).json({ error: 'filename, mimeType, and data are required' });
    }

    // Calculate file size from base64 data
    // Base64 encodes 3 bytes into 4 characters, so we estimate the original size
    const base64Data = data.replace(/^data:[^;]+;base64,/, '');
    const fileSize = Math.round((base64Data.length * 3) / 4);

    const file = await UploadedFile.create({
      filename,
      mimeType,
      fileSize,
      data: base64Data.startsWith('data:') ? data : `data:${mimeType};base64,${base64Data}`,
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
