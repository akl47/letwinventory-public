'use strict';

// Consolidate assemblies into the CAD model table.
//
// DesignAssemblies duplicated DesignCADModels' entire VCS working-copy column
// block; assemblies now live as DesignCADModels rows discriminated by
// `isAssembly` and carrying their document in `assemblyDoc`. The existing
// partial unique index (one active row per part) now enforces "one design row
// per part, of exactly one kind". Existing dev assemblies are NOT migrated
// (confirmed disposable test data — recreate by hand); their VCS repos
// (repoType 'assembly') are untouched and reattach when an assembly is
// recreated for the same part lineage.
//
// Transactional + idempotent per house style.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE "DesignCADModels"
          ADD COLUMN IF NOT EXISTS "isAssembly" BOOLEAN NOT NULL DEFAULT FALSE
      `, { transaction });
      await queryInterface.sequelize.query(`
        ALTER TABLE "DesignCADModels"
          ADD COLUMN IF NOT EXISTS "assemblyDoc" JSONB
      `, { transaction });
      // History first (FK to DesignAssemblies).
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

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Recreate the standalone tables (DDL inlined from
      // 20260605000000-create-design-assemblies.js). Assembly rows that were
      // created on the unified table are NOT moved back.
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
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS design_assemblies_part_unique_active
          ON "DesignAssemblies" ("partID")
          WHERE "activeFlag" = TRUE
      `, { transaction });
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
      await queryInterface.sequelize.query(`
        ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "assemblyDoc"
      `, { transaction });
      await queryInterface.sequelize.query(`
        ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "isAssembly"
      `, { transaction });
    });
  },
};
