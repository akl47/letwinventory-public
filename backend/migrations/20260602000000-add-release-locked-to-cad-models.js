'use strict';

// Two-tier release workflow — a development release locks the design read-only.
// `releaseLocked` makes the working copy immutable (edits require a new
// revision); distinct from the checkout edit-lock and from Parts.revisionLocked.
//
// Transactional + idempotent per house style — ADD COLUMN IF NOT EXISTS.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" ADD COLUMN IF NOT EXISTS "releaseLocked" BOOLEAN NOT NULL DEFAULT FALSE`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "releaseLocked"`,
        { transaction },
      );
    });
  },
};
