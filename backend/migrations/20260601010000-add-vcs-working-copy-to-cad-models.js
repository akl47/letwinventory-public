'use strict';

// Phase 1 (REQ 677-681) — repurpose DesignCADModels into the VCS working copy.
// Adds branch/base-commit/dirty + the exclusive edit-lock columns. Additive and
// non-destructive: the existing revision/releaseState columns stay for now;
// their retirement (revision unification, VC-19) is a later, separate step.
//
// Transactional + idempotent per house style — ADD COLUMN IF NOT EXISTS so an
// interrupted run can be retried, wrapped in one transaction.

const COLUMNS = [
  ['branchName', `VARCHAR(255) NOT NULL DEFAULT 'main'`],
  ['baseCommitHash', `VARCHAR(64)`],
  ['dirty', `BOOLEAN NOT NULL DEFAULT FALSE`],
  ['lockedByUserID', `INTEGER`],
  ['lockedAt', `TIMESTAMP WITH TIME ZONE`],
  ['lockExpiresAt', `TIMESTAMP WITH TIME ZONE`],
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [name, type] of COLUMNS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "DesignCADModels" ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
          { transaction },
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [name] of COLUMNS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "${name}"`,
          { transaction },
        );
      }
    });
  },
};
