'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

function getUploadDir() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return path.join('uploads', String(year), month);
}

/**
 * Save a buffer to disk. Returns the relative file path (from STORAGE_PATH).
 */
function saveFile(buffer, mimeType, originalFilename) {
  const dir = getUploadDir();
  const absDir = path.join(STORAGE_PATH, dir);
  fs.mkdirSync(absDir, { recursive: true });

  const ext = MIME_TO_EXT[mimeType] || path.extname(originalFilename || '').replace('.', '') || 'bin';
  const uuid = crypto.randomUUID();
  const filename = `${uuid}.${ext}`;
  const relativePath = path.join(dir, filename);
  const absolutePath = path.join(STORAGE_PATH, relativePath);

  fs.writeFileSync(absolutePath, buffer);
  return relativePath;
}

/**
 * Get absolute path from a relative file path.
 */
function getAbsolutePath(relativePath) {
  return path.join(STORAGE_PATH, relativePath);
}

/**
 * Check if a file exists on disk.
 */
function fileExists(relativePath) {
  try {
    return fs.existsSync(path.join(STORAGE_PATH, relativePath));
  } catch {
    return false;
  }
}

/**
 * Delete a file from disk.
 */
function deleteFile(relativePath) {
  const abs = path.join(STORAGE_PATH, relativePath);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
}

/**
 * Decode a base64 data URI or raw base64 string to a Buffer.
 */
function decodeBase64(data) {
  const raw = data.replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(raw, 'base64');
}

module.exports = {
  saveFile,
  getAbsolutePath,
  fileExists,
  deleteFile,
  decodeBase64,
  STORAGE_PATH,
};
