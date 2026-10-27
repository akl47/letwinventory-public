'use strict';

// CAD review hardening (2026-10-26):
//   REQ 947 — VcsWorkflowStates.approvedCommitHash binds an approval to the
//             commit it reviewed.
//   REQ 949 — VcsWorkflowStates.submittedByUserID records the submitter, who
//             may not approve their own submission.
//   REQ 960 — BillOfMaterialItems.syncedFromAssemblyID marks rows written by an
//             assembly BOM sync, so sync replaces only its own rows. Existing
//             rows stay NULL (treated as manual, so the first sync after this
//             migration adds rows rather than deleting any).
//
// Transactional + idempotent (ADD COLUMN IF NOT EXISTS).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`ALTER TABLE "VcsWorkflowStates" ADD COLUMN IF NOT EXISTS "approvedCommitHash" VARCHAR(64)`);
      await q(`ALTER TABLE "VcsWorkflowStates" ADD COLUMN IF NOT EXISTS "submittedByUserID" INTEGER`);
      await q(`ALTER TABLE "BillOfMaterialItems" ADD COLUMN IF NOT EXISTS "syncedFromAssemblyID" INTEGER`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`ALTER TABLE "VcsWorkflowStates" DROP COLUMN IF EXISTS "approvedCommitHash"`);
      await q(`ALTER TABLE "VcsWorkflowStates" DROP COLUMN IF EXISTS "submittedByUserID"`);
      await q(`ALTER TABLE "BillOfMaterialItems" DROP COLUMN IF EXISTS "syncedFromAssemblyID"`);
    });
  },
};
