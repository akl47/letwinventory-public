'use strict';

// REQ 1062–1066 — wire harnesses get the CAD-style version-control workflow in
// their own backend. `WireHarnesses` becomes the working copy of a per-harness
// repository (objects/refs live in the shared VcsObjects/VcsRefs store under
// repoType 'harness'), so it gains the same working-copy columns as
// DesignCADModels. Repositories themselves are created lazily on first access
// (harnessVcsService.ensureRepo) — no data migration.
//
// Also seeds the `harness.approve` permission (review approval, production
// release, force-unlock) and grants it to the Admin group.
//
// Transactional + idempotent per house style.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql, opts = {}) => queryInterface.sequelize.query(sql, { transaction, ...opts });
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "branchName" VARCHAR(255) NOT NULL DEFAULT 'main'`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "baseCommitHash" VARCHAR(64)`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "dirty" BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "lastContentSavedAt" TIMESTAMP WITH TIME ZONE`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "lockedByUserID" INTEGER REFERENCES "Users" (id)`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP WITH TIME ZONE`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "lockExpiresAt" TIMESTAMP WITH TIME ZONE`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "releaseLocked" BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`ALTER TABLE "WireHarnesses" ADD COLUMN IF NOT EXISTS "createdByUserID" INTEGER REFERENCES "Users" (id)`);
      await q(`UPDATE "WireHarnesses" SET "releaseLocked" = TRUE WHERE "releaseState" = 'released'`);

      await q(`
        INSERT INTO "Permissions" (resource, action, "createdAt")
        VALUES ('harness', 'approve', NOW())
        ON CONFLICT (resource, action) DO NOTHING
      `);
      const [adminGroup] = await q(`SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`);
      if (adminGroup.length > 0) {
        await q(`
          INSERT INTO "GroupPermissions" ("groupID", "permissionID", "createdAt")
          SELECT $1, id, NOW() FROM "Permissions" WHERE resource = 'harness' AND action = 'approve'
          ON CONFLICT ("groupID", "permissionID") DO NOTHING
        `, { bind: [adminGroup[0].id] });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource = 'harness' AND action = 'approve')`);
      await q(`DELETE FROM "UserPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource = 'harness' AND action = 'approve')`);
      await q(`DELETE FROM "Permissions" WHERE resource = 'harness' AND action = 'approve'`);
      for (const col of ['branchName', 'baseCommitHash', 'dirty', 'lastContentSavedAt', 'lockedByUserID', 'lockedAt', 'lockExpiresAt', 'releaseLocked', 'createdByUserID']) {
        await q(`ALTER TABLE "WireHarnesses" DROP COLUMN IF EXISTS "${col}"`);
      }
    });
  },
};
