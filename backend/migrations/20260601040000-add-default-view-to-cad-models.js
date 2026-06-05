'use strict';

// REQ 708/709 — persist a per-model "default view": the camera orientation the
// viewer returns to via the Default-view control and frames commit thumbnails
// from. It is a view preference (not part of the versioned doc), so it lives in
// its own nullable column and is editable without a checkout.
//
// Transactional + idempotent per house style — ADD COLUMN IF NOT EXISTS.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" ADD COLUMN IF NOT EXISTS "defaultView" JSONB`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "DesignCADModels" DROP COLUMN IF EXISTS "defaultView"`,
        { transaction },
      );
    });
  },
};
