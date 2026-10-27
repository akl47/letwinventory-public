'use strict';

// One-time, idempotent import of existing CAD models into the VCS object store
// (REQ 689 / VC-21). Usage: `node backend/scripts/migrate-cad-to-vcs.js`.
// Safe to re-run — already-migrated models are skipped.

const db = require('../models');
const { migrateAll } = require('../services/vcs/cadMigrationService');

(async () => {
  try {
    const { total, created } = await migrateAll(db);
    console.log(`CAD→VCS migration complete: ${created} new commit(s) across ${total} active model(s).`);
    process.exit(0);
  } catch (err) {
    console.error('CAD→VCS migration failed:', err.message);
    process.exit(1);
  }
})();
