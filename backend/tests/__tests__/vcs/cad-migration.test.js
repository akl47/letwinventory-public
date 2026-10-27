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

  test('migrateAll imports every active working copy', async () => {
    const partA = await createTestPart();
    const partB = await createTestPart();
    await makeModel(uid, partA.id);
    await makeModel(uid, partB.id);
    const { total, created } = await migrateAll();
    expect(total).toBe(2);
    expect(created).toBe(2);
  });
});
