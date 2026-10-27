'use strict';

// REQ 700 (Phase 1) — per-feature BRep + tessellated-mesh cache. The cache is
// *derived* from the featureTree definition — keyed by the hash triple
// (featureId, paramHash, upstreamHash) so any kernel worker can rehydrate any
// session. featureTree JSONB stays authoritative; this table can be dropped
// + rebuilt at any time without losing user data.
//
// Idempotent + transactional. The repo's Docker dev workflow has a history
// of hot-reload interrupting migrations mid-flight and leaving partial
// state (table created, SequelizeMeta row missing — see CLAUDE.md
// 2026-05-12). Wrapping in `sequelize.transaction(...)` rolls back the
// whole DDL on any failure, and `IF NOT EXISTS` lets a successful retry
// pick up where an interrupted run left off.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "DesignBRepCache" (
          id SERIAL PRIMARY KEY,
          "cadModelID" INTEGER NOT NULL
            REFERENCES "DesignCADModels"(id) ON UPDATE CASCADE ON DELETE CASCADE,
          "featureID" VARCHAR(64) NOT NULL,
          -- Hash of this feature's own parameters (distance/flipped/loopIndices/
          -- resolved sketch state). Changes when the user edits the feature.
          "paramHash" VARCHAR(64) NOT NULL,
          -- Hash of the upstream BRep this feature was applied on top of. Empty
          -- string for root-level features. Changes when ANY upstream feature
          -- changes — cascade invalidation falls out naturally.
          "upstreamHash" VARCHAR(64) NOT NULL DEFAULT '',
          -- OCCT BREP serialization. Phase 0 spike writes the text form; Phase 1
          -- moves to BinTools binary once the kernel exposes an in-memory writer.
          "brepBytes" BYTEA NOT NULL,
          -- The tessellated face meshes (positions/normals/indices per face) the
          -- viewer renders. We cache these alongside BREP so a cache hit avoids
          -- re-tessellation, not just re-compute.
          "tessellatedFaces" JSONB NOT NULL,
          -- NAMING_SCHEMA_VERSION from cad-kernel/main.rs. Stale-version rows
          -- get evicted when the algorithm bumps.
          "namingVersion" INTEGER NOT NULL DEFAULT 1,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "lastAccessedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      // The (model, feature, paramHash, upstreamHash) tuple is the canonical
      // cache key — any one of those changing produces a different entry.
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS design_brep_cache_key_unique
          ON "DesignBRepCache" ("cadModelID", "featureID", "paramHash", "upstreamHash")
      `, { transaction });
      // Idle eviction scans this index — keep cheap.
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS design_brep_cache_last_accessed_at_idx
          ON "DesignBRepCache" ("lastAccessedAt")
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP TABLE IF EXISTS "DesignBRepCache"`,
        { transaction },
      );
    });
  },
};
