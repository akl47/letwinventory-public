'use strict';

// Phase 0 VCS kernel (REQ 668-676) — content-addressed object store + refs +
// the where-used / changeset seams. Generic and domain-agnostic; the CAD
// binding (Phase 1) sits on top.
//
// Idempotent + transactional, per house style (CLAUDE.md 2026-05-12): a
// hot-reload interrupting a migration must not leave partial state. The whole
// DDL runs in one transaction (rolls back on any failure) and every statement
// is `IF NOT EXISTS` so a retry picks up cleanly.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // ── Objects: immutable, content-addressed, deduplicated per repo ──────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "VcsObjects" (
          "repoType" VARCHAR(32) NOT NULL,
          "repoId"   VARCHAR(64) NOT NULL,
          -- sha256 hex of (kind + canonical content); same content => one row
          "hash"     VARCHAR(64) NOT NULL,
          "kind"     VARCHAR(16) NOT NULL
            CHECK ("kind" IN ('blob','tree','commit','geometry','component')),
          -- JSON payload for blob/tree/commit/component kinds
          "content"  JSONB,
          -- binary payload for geometry (frozen BRep/mesh) kind
          "bytes"    BYTEA,
          "size"     INTEGER NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("repoType", "repoId", "hash")
        )
      `, { transaction });

      // ── Refs: branches (mutable) + tags (write-once) ─────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "VcsRefs" (
          id SERIAL PRIMARY KEY,
          "repoType" VARCHAR(32) NOT NULL,
          "repoId"   VARCHAR(64) NOT NULL,
          "name"     VARCHAR(255) NOT NULL,
          "kind"     VARCHAR(8) NOT NULL CHECK ("kind" IN ('branch','tag')),
          "targetHash" VARCHAR(64) NOT NULL,
          "updatedByUserID" INTEGER,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS vcs_refs_repo_name_unique
          ON "VcsRefs" ("repoType", "repoId", "name")
      `, { transaction });

      // ── Where-used index (assembly seam) ─────────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "VcsUsages" (
          id SERIAL PRIMARY KEY,
          "childRepoType" VARCHAR(32) NOT NULL,
          "childRepoId"   VARCHAR(64) NOT NULL,
          "parentRepoType" VARCHAR(32) NOT NULL,
          "parentRepoId"   VARCHAR(64) NOT NULL,
          "parentCommitHash" VARCHAR(64) NOT NULL,
          "instanceId" VARCHAR(128),
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS vcs_usages_child_idx
          ON "VcsUsages" ("childRepoType", "childRepoId")
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS vcs_usages_parent_idx
          ON "VcsUsages" ("parentRepoType", "parentRepoId", "parentCommitHash")
      `, { transaction });

      // ── Cross-repo changeset seam (reserved) ─────────────────────────────
      await queryInterface.sequelize.query(`
        CREATE TABLE IF NOT EXISTS "VcsChangesets" (
          id SERIAL PRIMARY KEY,
          "description" VARCHAR(1024),
          "authorUserID" INTEGER,
          "commits" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "VcsChangesets"`, { transaction });
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "VcsUsages"`, { transaction });
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "VcsRefs"`, { transaction });
      await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "VcsObjects"`, { transaction });
    });
  },
};
