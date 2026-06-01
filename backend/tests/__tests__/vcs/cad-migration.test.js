'use strict';

// REQ 689 (VC-21) — one-time import of existing models into the VCS store.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');
const cadvcs = require('../../../services/vcs/cadVcsService');
const { cadDeserialize } = require('../../../services/vcs/cadSerializer');
const { migrateModelToVcs, migrateAll } = require('../../../services/vcs/cadMigrationService');

async function makeModel(uid, partId, overrides = {}) {
  return db.DesignCADModel.create({
    partID: partId, revision: 'A',
    featureTree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 },
    sketchDoc: { sketches: {}, nextSketchSeq: 1 }, equations: { entries: {} },
    releaseState: 'draft', createdByUserID: uid, activeFlag: true, ...overrides,
  });
}

describe('cadMigrationService', () => {
  let uid;
  beforeEach(async () => { uid = (await authenticatedRequest()).user.id; });

  test('imports a model as an initial commit on main + sets baseCommitHash', async () => {
    const part = await createTestPart();
    const model = await makeModel(uid, part.id);
    const { repo, commitHash, created } = await migrateModelToVcs(model);
    expect(created).toBe(true);
    expect((await vcs.getRef(repo, 'main')).targetHash).toBe(commitHash);
    await model.reload();
    expect(model.baseCommitHash).toBe(commitHash);
    expect(model.dirty).toBe(false);

    const commit = await vcs.getCommit(repo, commitHash);
    const doc = await cadDeserialize(repo, commit.treeHash);
    expect(doc.featureTree.features.map(f => f.id)).toEqual(['f1']);
  });

  test('is idempotent — re-running creates no new commit', async () => {
    const part = await createTestPart();
    const model = await makeModel(uid, part.id);
    const r1 = await migrateModelToVcs(model);
    await model.reload();
    const r2 = await migrateModelToVcs(model);
    expect(r2.created).toBe(false);
    expect(r2.commitHash).toBe(r1.commitHash);
  });

  test('tags released models with their revision', async () => {
    const part = await createTestPart();
    const model = await makeModel(uid, part.id, { revision: 'B', releaseState: 'released', releasedAt: new Date(), releasedByUserID: uid });
    const { repo, commitHash } = await migrateModelToVcs(model);
    expect(await vcs.getRef(repo, 'B')).toMatchObject({ kind: 'tag', targetHash: commitHash });
  });

  test('migrateAll chains revisions of one part into a continuous history', async () => {
    const part = await createTestPart();
    const a = await makeModel(uid, part.id, { revision: 'A' });
    const b = await makeModel(uid, part.id, {
      revision: 'B', previousRevisionID: a.id,
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 },
    });
    const { total, created } = await migrateAll();
    expect(total).toBe(2);
    expect(created).toBe(2);

    await a.reload(); await b.reload();
    const repo = await cadvcs.repoForModel(b);
    const headCommit = await vcs.getCommit(repo, b.baseCommitHash);
    expect(headCommit.parents).toEqual([a.baseCommitHash]);
  });
});
