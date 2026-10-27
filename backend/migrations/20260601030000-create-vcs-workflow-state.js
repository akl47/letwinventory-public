'use strict';

// Phase 4 (REQ 703 / VC-35) — generic per-repository workflow state for the
// declarative workflow engine. Transactional + idempotent.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "VcsWorkflowStates" (
          "repoType" VARCHAR(32) NOT NULL,
          "repoId"   VARCHAR(64) NOT NULL,
          "state"    VARCHAR(32) NOT NULL,
          "updatedByUserID" INTEGER,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("repoType", "repoId")
        )
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "VcsWorkflowStates"`, { transaction });
    });
  },
};
