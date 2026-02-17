'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Backfill any NULLs before adding NOT NULL constraint
    await queryInterface.sequelize.query(
      `UPDATE "DesignRequirements" SET "rationale" = '' WHERE "rationale" IS NULL`
    );
    await queryInterface.sequelize.query(
      `UPDATE "DesignRequirements" SET "verification" = '' WHERE "verification" IS NULL`
    );
    await queryInterface.sequelize.query(
      `UPDATE "DesignRequirements" SET "validation" = '' WHERE "validation" IS NULL`
    );

    await queryInterface.changeColumn('DesignRequirements', 'rationale', {
      type: Sequelize.TEXT,
      allowNull: false
    });
    await queryInterface.changeColumn('DesignRequirements', 'verification', {
      type: Sequelize.TEXT,
      allowNull: false
    });
    await queryInterface.changeColumn('DesignRequirements', 'validation', {
      type: Sequelize.TEXT,
      allowNull: false
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('DesignRequirements', 'rationale', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.changeColumn('DesignRequirements', 'verification', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.changeColumn('DesignRequirements', 'validation', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  }
};
