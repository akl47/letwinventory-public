'use strict';

// REQ 700 (Phase 1) — per-feature BRep + tessellated-mesh cache. The cache is
// *derived* from the featureTree definition — keyed by the hash triple
// (featureId, paramHash, upstreamHash) so any kernel worker can rehydrate any
// session. featureTree JSONB stays authoritative; this table can be dropped
// + rebuilt at any time without losing user data.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DesignBRepCache', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      cadModelID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'DesignCADModels', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      featureID: { type: Sequelize.STRING(64), allowNull: false },
      // Hash of this feature's own parameters (distance/flipped/loopIndices/
      // resolved sketch state). Changes when the user edits the feature.
      paramHash: { type: Sequelize.STRING(64), allowNull: false },
      // Hash of the upstream BRep this feature was applied on top of. Empty
      // string for root-level features (e.g. base extrudes from a datum
      // plane). Changes when ANY upstream feature changes — cache invalidation
      // cascade falls out naturally.
      upstreamHash: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },
      // OCCT BREP serialization. Phase 0 spike writes the text form; Phase 1
      // moves to BinTools binary once the kernel exposes an in-memory writer.
      brepBytes: { type: Sequelize.BLOB('long'), allowNull: false },
      // The tessellated face meshes (positions/normals/indices per face) the
      // viewer renders. We cache these alongside BREP so a cache hit avoids
      // re-tessellation, not just re-compute. Schema matches the kernel's
      // BuildExtrudeResult.faces.
      tessellatedFaces: { type: Sequelize.JSONB, allowNull: false },
      // Naming-schema version (NAMING_SCHEMA_VERSION from cad-kernel/main.rs).
      // Entries with a stale version are invalidated when the algorithm bumps.
      namingVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      lastAccessedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    // The (model, feature, paramHash, upstreamHash) tuple is the canonical
    // cache key — any one of those changing produces a different entry.
    await queryInterface.addIndex(
      'DesignBRepCache',
      ['cadModelID', 'featureID', 'paramHash', 'upstreamHash'],
      { unique: true, name: 'design_brep_cache_key_unique' },
    );
    // Idle eviction scans this index — keep cheap.
    await queryInterface.addIndex('DesignBRepCache', ['lastAccessedAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('DesignBRepCache');
  },
};
