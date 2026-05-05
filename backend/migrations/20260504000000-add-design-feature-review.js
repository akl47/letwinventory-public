'use strict';

/**
 * Combined migration for the Feature Review system. Subsumes what were
 * originally three migrations:
 *   - 20260504000000-add-design-feature-review (base tables)
 *   - 20260505000000-add-github-sync           (PAT + PR metadata)
 *   - 20260505100000-add-github-repo-to-features (repo field)
 *
 * The merged version is what fresh installs should run; on systems that
 * applied the originals separately, see the README/notes for the
 * SequelizeMeta cleanup steps.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = Sequelize.literal('NOW()');

    await queryInterface.createTable('DesignFeatures', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      slug: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      markdownBody: { type: Sequelize.TEXT, allowNull: true },
      projectID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Projects', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      ownerUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      reviewerUserID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      approvedByUserID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      releasedByUserID: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      reviewState: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
      submittedAt: { type: Sequelize.DATE, allowNull: true },
      approvedAt: { type: Sequelize.DATE, allowNull: true },
      releasedAt: { type: Sequelize.DATE, allowNull: true },
      branchName: { type: Sequelize.STRING(255), allowNull: true },
      prURL: { type: Sequelize.STRING(500), allowNull: true },
      commitRefs: { type: Sequelize.JSON, allowNull: true },

      // Cached GitHub PR metadata (populated by Sync from GitHub).
      prState: { type: Sequelize.STRING(20), allowNull: true },
      prTitle: { type: Sequelize.STRING(500), allowNull: true },
      prMergedAt: { type: Sequelize.DATE, allowNull: true },
      prHeadSha: { type: Sequelize.STRING(64), allowNull: true },
      lastSyncedAt: { type: Sequelize.DATE, allowNull: true },

      // owner/repo for branch-only features (when prURL hasn't been set yet).
      githubRepo: { type: Sequelize.STRING(255), allowNull: true },

      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    // Partial unique index: slug unique among active rows so soft-deleted
    // slugs can be re-used.
    await queryInterface.addIndex('DesignFeatures', ['slug'], {
      unique: true,
      where: { activeFlag: true },
      name: 'design_features_slug_unique_active',
    });
    await queryInterface.addIndex('DesignFeatures', ['projectID']);
    await queryInterface.addIndex('DesignFeatures', ['reviewState']);
    await queryInterface.addIndex('DesignFeatures', ['activeFlag']);

    await queryInterface.createTable('DesignFeatureHistory', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      designFeatureID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'DesignFeatures', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      changeType: { type: Sequelize.STRING(40), allowNull: false },
      changes: { type: Sequelize.JSON, allowNull: true },
      snapshotData: { type: Sequelize.JSON, allowNull: true },
      changeNotes: { type: Sequelize.TEXT, allowNull: true },
      changedByUserID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('DesignFeatureHistory', ['designFeatureID']);

    // Add designFeatureID FK to DesignRequirements (nullable, SET NULL on delete).
    await queryInterface.addColumn('DesignRequirements', 'designFeatureID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'DesignFeatures', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('DesignRequirements', ['designFeatureID']);

    // Per-user GitHub Personal Access Token. Stored as plaintext TEXT —
    // protect with the existing auth boundary (only the owning user can
    // read/write their own value via /api/auth/user/github-pat).
    await queryInterface.addColumn('Users', 'githubPAT', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    // Seed 'features' permission resource (read/write/delete) + features.approve.
    const permNow = new Date();
    const newPerms = [
      { resource: 'features', action: 'read', createdAt: permNow },
      { resource: 'features', action: 'write', createdAt: permNow },
      { resource: 'features', action: 'delete', createdAt: permNow },
      { resource: 'features', action: 'approve', createdAt: permNow },
    ];
    await queryInterface.bulkInsert('Permissions', newPerms);

    const [adminGroup] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`
    );
    if (adminGroup.length > 0) {
      const adminGroupId = adminGroup[0].id;
      const [perms] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE resource = 'features'`
      );
      const gpRows = perms.map(p => ({
        groupID: adminGroupId,
        permissionID: p.id,
        createdAt: permNow,
      }));
      if (gpRows.length > 0) {
        await queryInterface.bulkInsert('GroupPermissions', gpRows);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'githubPAT');
    await queryInterface.removeColumn('DesignRequirements', 'designFeatureID');
    await queryInterface.dropTable('DesignFeatureHistory');
    await queryInterface.dropTable('DesignFeatures');
    await queryInterface.sequelize.query(
      `DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE resource = 'features')`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "Permissions" WHERE resource = 'features'`
    );
  },
};
