'use strict';

// REQ 1069 — parts can be linked to projects (many-to-many) and marked common
// (usable in every project).
//
// Transactional + idempotent per house style.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`ALTER TABLE "Parts" ADD COLUMN IF NOT EXISTS "commonPart" BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`
        CREATE TABLE IF NOT EXISTS "PartProjects" (
          "id" SERIAL PRIMARY KEY,
          "partID" INTEGER NOT NULL REFERENCES "Parts" (id) ON DELETE CASCADE,
          "projectID" INTEGER NOT NULL REFERENCES "Projects" (id) ON DELETE CASCADE,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS part_projects_part_project_unique ON "PartProjects" ("partID", "projectID")`);
      await q(`CREATE INDEX IF NOT EXISTS part_projects_project_id_idx ON "PartProjects" ("projectID")`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`DROP TABLE IF EXISTS "PartProjects"`);
      await q(`ALTER TABLE "Parts" DROP COLUMN IF EXISTS "commonPart"`);
    });
  },
};
