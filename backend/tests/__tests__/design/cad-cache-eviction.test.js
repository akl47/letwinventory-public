// REQ 700 (Phase 1) — idle eviction of DesignBRepCache rows.
//
// The eviction job runs hourly in production. The test calls
// `evictStaleEntries` directly so we don't have to wait for setInterval
// to fire.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const { evictStaleEntries, MAX_AGE_DAYS } = require('../../../services/cadCacheEvictionService');
const db = require('../../../models');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('cadCacheEvictionService', () => {
  let model;

  beforeEach(async () => {
    await authenticatedRequest();  // bootstrap the test user
    const part = await createTestPart();
    model = await db.DesignCADModel.create({
      partID: part.id,
      revision: 'A',
      featureTree: { features: [] },
      sketchDoc: { sketches: {} },
      releaseState: 'draft',
      createdByUserID: 1,
      activeFlag: true,
    });
  });

  it('drops rows older than MAX_AGE_DAYS and keeps fresh ones', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const stale = new Date(now.getTime() - (MAX_AGE_DAYS + 1) * ONE_DAY_MS);
    const fresh = new Date(now.getTime() - 1 * ONE_DAY_MS);

    await db.DesignBRepCache.create({
      cadModelID: model.id,
      featureID: 'f1#0',
      paramHash: 'aaaa', upstreamHash: '',
      brepBytes: Buffer.from('x'),
      tessellatedFaces: { faces: [], topology: { vertices: [], edges: [] } },
      namingVersion: 1,
      lastAccessedAt: stale,
    });
    await db.DesignBRepCache.create({
      cadModelID: model.id,
      featureID: 'f2#0',
      paramHash: 'bbbb', upstreamHash: '',
      brepBytes: Buffer.from('y'),
      tessellatedFaces: { faces: [], topology: { vertices: [], edges: [] } },
      namingVersion: 1,
      lastAccessedAt: fresh,
    });

    const deleted = await evictStaleEntries(now, db);
    expect(deleted).toBe(1);

    const surviving = await db.DesignBRepCache.findAll({ where: { cadModelID: model.id } });
    expect(surviving).toHaveLength(1);
    expect(surviving[0].featureID).toBe('f2#0');
  });
});
