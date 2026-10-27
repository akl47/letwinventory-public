'use strict';

// REQ 877 — stale uncommitted-changes warning. `lastContentSavedAt` records
// the last CONTENT-changing save (featureTree/sketchDoc/equations); unlike
// updatedAt it is untouched by renames, lock heartbeats, and default-view
// saves, so "dirty and idle for 4 hours" is computable.
//
// Backfill: rows already dirty get updatedAt as an approximation — inflated by
// heartbeats, which only DELAYS their first warning (the safe direction).
//
// Transactional + idempotent per house style — ADD COLUMN IF NOT EXISTS.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" ADD COLUMN IF NOT EXISTS "lastContentSavedAt" TIMESTAMP WITH TIME ZONE`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE "DesignCADModels" SET "lastContentSavedAt" = "updatedAt" WHERE "dirty" = TRUE AND "lastContentSavedAt" IS NULL`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "lastContentSavedAt"`,
        { transaction },
      );
    });
  },
};
