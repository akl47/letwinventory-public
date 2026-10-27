'use strict';

// Original migration for DesignCADModels + DesignCADModelHistory + the `cad`
// permission resource. Rewritten to be idempotent + transactional after a
// `sequelize.sync()` race (removed 2026-05-15) left some dev DBs with the
// DesignCADModels table but no History table and no SequelizeMeta row.
// Subsequent runs would collide on the existing table.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // ── DesignCADModels ───────────────────────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "DesignCADModels" (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          "partID" INTEGER NOT NULL
            REFERENCES "Parts"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          revision VARCHAR(10) NOT NULL DEFAULT 'A',
          "previousRevisionID" INTEGER
            REFERENCES "DesignCADModels"(id) ON UPDATE CASCADE ON DELETE SET NULL,
          "featureTree" JSONB NOT NULL,
          "sketchDoc" JSONB NOT NULL,
          "releaseState" VARCHAR(20) NOT NULL DEFAULT 'draft',
          "submittedAt" TIMESTAMP WITH TIME ZONE,
          "releasedAt" TIMESTAMP WITH TIME ZONE,
          "releasedByUserID" INTEGER
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE SET NULL,
          "createdByUserID" INTEGER NOT NULL
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          "activeFlag" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS design_cad_models_part_id_idx
          ON "DesignCADModels" ("partID")
      `, { transaction });
      // Partial unique index — one active revision letter per part. Soft-
      // deleted rows (activeFlag = false) don't count toward uniqueness so
      // we can free up letters when revisions are scrapped.
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS design_cad_models_part_revision_unique_active
          ON "DesignCADModels" ("partID", revision)
          WHERE "activeFlag" = TRUE
      `, { transaction });

      // ── DesignCADModelHistory ─────────────────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "DesignCADModelHistory" (
          id SERIAL PRIMARY KEY,
          "cadModelID" INTEGER NOT NULL
            REFERENCES "DesignCADModels"(id) ON UPDATE CASCADE ON DELETE CASCADE,
          "changeType" VARCHAR(30) NOT NULL,
          "changedByUserID" INTEGER NOT NULL
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          "previousState" JSONB,
          "newState" JSONB,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS design_cad_model_history_cad_model_id_idx
          ON "DesignCADModelHistory" ("cadModelID")
      `, { transaction });

      // ── Permissions seed ──────────────────────────────────────────────
      // ON CONFLICT DO NOTHING handles the (rare) case where the row
      // already exists from a previous partial run.
      await queryInterface.sequelize.query(`
        INSERT INTO "Permissions" (resource, action, "createdAt")
        VALUES
          ('cad', 'read', NOW()),
          ('cad', 'write', NOW()),
          ('cad', 'delete', NOW()),
          ('cad', 'approve', NOW())
        ON CONFLICT (resource, action) DO NOTHING
      `, { transaction });

      // Grant the four cad permissions to the Admin group. The compound
      // (groupID, permissionID) is the natural key — ON CONFLICT lets us
      // re-run safely.
      const [adminGroup] = await queryInterface.sequelize.query(
        `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`,
        { transaction },
      );
      if (adminGroup.length > 0) {
        await queryInterface.sequelize.query(`
          INSERT INTO "GroupPermissions" ("groupID", "permissionID", "createdAt")
          SELECT $1, id, NOW() FROM "Permissions" WHERE resource = 'cad'
          ON CONFLICT ("groupID", "permissionID") DO NOTHING
        `, { transaction, bind: [adminGroup[0].id] });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP TABLE IF EXISTS "DesignCADModelHistory"`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DROP TABLE IF EXISTS "DesignCADModels"`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM "GroupPermissions" WHERE "permissionID" IN
          (SELECT id FROM "Permissions" WHERE resource = 'cad')`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM "Permissions" WHERE resource = 'cad'`,
        { transaction },
      );
    });
  },
};
