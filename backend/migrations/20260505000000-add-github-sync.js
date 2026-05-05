'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Per-user GitHub Personal Access Token. Stored as plaintext TEXT —
    // protect with the existing auth boundary (only the owning user can
    // read/write their own value via /api/auth/user/github-pat).
    await queryInterface.addColumn('Users', 'githubPAT', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    // Cached GitHub PR metadata on the DesignFeature.
    await queryInterface.addColumn('DesignFeatures', 'prState', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('DesignFeatures', 'prTitle', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn('DesignFeatures', 'prMergedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('DesignFeatures', 'prHeadSha', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('DesignFeatures', 'lastSyncedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('DesignFeatures', 'lastSyncedAt');
    await queryInterface.removeColumn('DesignFeatures', 'prHeadSha');
    await queryInterface.removeColumn('DesignFeatures', 'prMergedAt');
    await queryInterface.removeColumn('DesignFeatures', 'prTitle');
    await queryInterface.removeColumn('DesignFeatures', 'prState');
    await queryInterface.removeColumn('Users', 'githubPAT');
  },
};
