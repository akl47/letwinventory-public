#!/usr/bin/env node
/**
 * One-time migration: moves base64 file data from the UploadedFiles table to disk.
 * Safe to re-run — skips files that already have a filePath.
 *
 * Usage: node scripts/migrate-files-to-disk.js
 * Requires FILE_STORAGE_PATH env var (defaults to /data/files).
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const { Sequelize } = require('sequelize');
const fileStorage = require('../backend/util/fileStorage');

const config = require('../backend/config/config');
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

async function main() {
  const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: false,
  });

  await sequelize.authenticate();
  console.log('Connected to database.');

  const BATCH_SIZE = 10;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const [files] = await sequelize.query(
      `SELECT id, filename, "mimeType", data FROM "UploadedFiles" WHERE data IS NOT NULL AND "filePath" IS NULL LIMIT ${BATCH_SIZE}`
    );

    if (files.length === 0) break;

    for (const file of files) {
      try {
        const buffer = fileStorage.decodeBase64(file.data);
        const filePath = fileStorage.saveFile(buffer, file.mimeType, file.filename);

        await sequelize.query(
          `UPDATE "UploadedFiles" SET "filePath" = :filePath, data = NULL WHERE id = :id`,
          { replacements: { filePath, id: file.id } }
        );

        migrated++;
        if (migrated % 10 === 0) {
          console.log(`  Migrated ${migrated} files...`);
        }
      } catch (err) {
        console.error(`  Failed to migrate file ${file.id} (${file.filename}):`, err.message);
        failed++;
      }
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped (already done): ${skipped}, Failed: ${failed}`);
  await sequelize.close();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
