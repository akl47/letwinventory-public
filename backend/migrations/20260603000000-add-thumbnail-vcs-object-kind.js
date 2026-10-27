'use strict';

// The VcsObject kind CHECK constraint (from 20260601000000) predates the
// `thumbnail` kind used to store commit preview images. The model's isIn
// validator already allows it, but the Postgres constraint rejected it — so
// commit thumbnails silently failed to persist. Add `thumbnail` to the allowed
// kinds. (SQLite test DBs have no CHECK constraint, which masked this.)

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "VcsObjects" DROP CONSTRAINT IF EXISTS "VcsObjects_kind_check";
      ALTER TABLE "VcsObjects" ADD CONSTRAINT "VcsObjects_kind_check"
        CHECK ("kind" IN ('blob','tree','commit','geometry','component','thumbnail'));
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "VcsObjects" DROP CONSTRAINT IF EXISTS "VcsObjects_kind_check";
      ALTER TABLE "VcsObjects" ADD CONSTRAINT "VcsObjects_kind_check"
        CHECK ("kind" IN ('blob','tree','commit','geometry','component'));
    `);
  },
};
