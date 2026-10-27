'use strict';

// Phase 1 (REQ 686-688 / VC-18, VC-19) — retire the CAD model's own revision +
// release-state machinery. Parts.revision is now the single revision identity
// and released states are write-once VCS tags, so the model becomes one editable
// working copy per part. Drops revision/previousRevisionID/releaseState/
// submittedAt/releasedAt/releasedByUserID and swaps the (partID,revision) unique
// index for a one-working-copy-per-part (partID) unique index.
//
// Run the CAD→VCS import (scripts/migrate-cad-to-vcs.js) BEFORE this so existing
// model state is captured as commits first. Transactional + idempotent.

const DROP_COLUMNS = ['revision', 'previousRevisionID', 'releaseState', 'submittedAt', 'releasedAt', 'releasedByUserID'];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Collapse to one active working copy per part (keep the newest row) so
      // the new unique index can be created.
      await queryInterface.sequelize.query(`
        UPDATE "DesignCADModels" SET "activeFlag" = false
        WHERE "activeFlag" = true AND id NOT IN (
          SELECT MAX(id) FROM "DesignCADModels" WHERE "activeFlag" = true GROUP BY "partID"
        )
      `, { transaction });

      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS design_cad_models_part_revision_unique_active`, { transaction });

      for (const col of DROP_COLUMNS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "${col}"`, { transaction });
      }
      // The releaseState ENUM type is left orphaned by the column drop.
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_DesignCADModels_releaseState"`, { transaction });

      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS design_cad_models_part_unique_active
          ON "DesignCADModels" ("partID") WHERE "activeFlag" = true
      `, { transaction });
    });
  },

  async down(queryInterface) {
    // Best-effort reversal — the retired data is not recoverable.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS design_cad_models_part_unique_active`, { transaction });
      const readd = [
        [`revision`, `VARCHAR(10) NOT NULL DEFAULT 'A'`],
        [`previousRevisionID`, `INTEGER`],
        [`releaseState`, `VARCHAR(16) NOT NULL DEFAULT 'draft'`],
        [`submittedAt`, `TIMESTAMP WITH TIME ZONE`],
        [`releasedAt`, `TIMESTAMP WITH TIME ZONE`],
        [`releasedByUserID`, `INTEGER`],
      ];
      for (const [col, type] of readd) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "DesignCADModels" ADD COLUMN IF NOT EXISTS "${col}" ${type}`, { transaction });
      }
    });
  },
};
