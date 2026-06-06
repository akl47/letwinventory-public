'use strict';

// DesignAssemblies + DesignAssemblyHistory (assembly MVP, REQ 750-754).
//
// An assembly is a Part-associated working copy that positions multiple
// component instances. It mirrors DesignCADModel's VCS working-copy columns
// (branch / base commit / checkout lock / release lock) and reuses the existing
// `cad` permission resource — no new permissions are seeded. Transactional +
// idempotent per house style (see the create-design-cad-models migration note).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // ── DesignAssemblies ──────────────────────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "DesignAssemblies" (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          "partID" INTEGER NOT NULL
            REFERENCES "Parts"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          "assemblyDoc" JSONB NOT NULL,
          "branchName" VARCHAR(255) NOT NULL DEFAULT 'main',
          "baseCommitHash" VARCHAR(64),
          dirty BOOLEAN NOT NULL DEFAULT FALSE,
          "lockedByUserID" INTEGER
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE SET NULL,
          "lockedAt" TIMESTAMP WITH TIME ZONE,
          "lockExpiresAt" TIMESTAMP WITH TIME ZONE,
          "defaultView" JSONB,
          "releaseLocked" BOOLEAN NOT NULL DEFAULT FALSE,
          "createdByUserID" INTEGER NOT NULL
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          "activeFlag" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS design_assemblies_part_id_idx
          ON "DesignAssemblies" ("partID")
      `, { transaction });
      // One active working copy per part (versions are VCS tags, not rows).
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS design_assemblies_part_unique_active
          ON "DesignAssemblies" ("partID")
          WHERE "activeFlag" = TRUE
      `, { transaction });

      // ── DesignAssemblyHistory ─────────────────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "DesignAssemblyHistory" (
          id SERIAL PRIMARY KEY,
          "assemblyID" INTEGER NOT NULL
            REFERENCES "DesignAssemblies"(id) ON UPDATE CASCADE ON DELETE CASCADE,
          "changeType" VARCHAR(30) NOT NULL,
          "changedByUserID" INTEGER NOT NULL
            REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          "previousState" JSONB,
          "newState" JSONB,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS design_assembly_history_assembly_id_idx
          ON "DesignAssemblyHistory" ("assemblyID")
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP TABLE IF EXISTS "DesignAssemblyHistory"`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DROP TABLE IF EXISTS "DesignAssemblies"`,
        { transaction },
      );
    });
  },
};
