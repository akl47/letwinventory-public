'use strict';

// REQ 692-697 (VC-24..29) — branch + cherry-pick HTTP routes.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');

async function setupCommitted(auth) {
  const part = await createTestPart();
  const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
  await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'init' });
  return model;
}

describe('CAD VCS branch routes', () => {
  test('create + list + switch + archive (guards current)', async () => {
    const auth = await authenticatedRequest();
    const model = await setupCommitted(auth);

    expect((await auth.post(`/api/design/cad-model/${model.id}/branches`).send({ name: 'variant' })).status).toBe(200);

    const list = await auth.get(`/api/design/cad-model/${model.id}/branches`);
    expect(list.status).toBe(200);
    // A new model auto-creates draft/01 and lands on it; plus main and variant.
    expect(list.body.map(b => b.name).sort()).toEqual(['draft/01', 'main', 'variant']);

    const sw = await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'variant' });
    expect(sw.status).toBe(200);
    expect(sw.body.branchName).toBe('variant');

    expect((await auth.delete(`/api/design/cad-model/${model.id}/branches/variant`)).status).toBe(409); // current
    await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'main' });
    expect((await auth.delete(`/api/design/cad-model/${model.id}/branches/variant`)).status).toBe(200);
  });

  test('cherry-pick a feature from another commit', async () => {
    const auth = await authenticatedRequest();
    const model = await setupCommitted(auth); // committed origin-only

    await auth.post(`/api/design/cad-model/${model.id}/branches`).send({ name: 'variant' });
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({}); // check-in released the lock
    await auth.put(`/api/design/cad-model/${model.id}`).send({
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 },
      sketchDoc: { sketches: { s1: { id: 's1', state: { entities: [], constraints: [] } } }, nextSketchSeq: 2 },
    });
    const c1 = (await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'add f2' })).body.commitHash;

    await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'variant' });
    // REQ 953 — cherry-pick needs the caller's checkout.
    const noLock = await auth.post(`/api/design/cad-model/${model.id}/cherry-pick`).send({ sourceCommit: c1, featureId: 'f2' });
    expect(noLock.status).toBe(423);
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const before = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;
    const cp = await auth.post(`/api/design/cad-model/${model.id}/cherry-pick`).send({ sourceCommit: c1, featureId: 'f2' });
    expect(cp.status).toBe(200);
    expect(cp.body.lastContentSavedAt).toBeTruthy();
    expect(cp.body.lastContentSavedAt).not.toEqual(before ? new Date(before).toISOString() : null);
    expect(cp.body.featureTree.features.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(cp.body.dirty).toBe(true);
  });
});

// REQ 953/954/955 — merge guards, CAS anchor, and equation merging.
describe('CAD merge (reconcile) guards + equations', () => {
  const vcs = require('../../../services/vcs/vcsService');
  const cadvcs = require('../../../services/vcs/cadVcsService');
  const U = (id, p = '') => `/api/design/cad-model/${id}${p}`;

  // main carries `shared`; branch 'feat' (forked before) adds `branchOnly` and
  // changes `shared`. Returns the model sitting on 'feat', NOT checked out.
  async function divergent(auth) {
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await auth.post(U(model.id, '/checkout')).send({});
    await auth.post(U(model.id, '/checkin')).send({ message: 'init' });
    await auth.post(U(model.id, '/branches')).send({ name: 'feat' });
    // draft/01: add `shared = 10`, release onto main.
    await auth.post(U(model.id, '/checkout')).send({});
    await auth.put(U(model.id)).send({ equations: { entries: { shared: { expression: '10' } } } });
    await auth.post(U(model.id, '/checkin')).send({ message: 'eq' });
    expect((await auth.post(U(model.id, '/release')).send({})).status).toBe(200);
    // feat: `shared = 20`, `branchOnly = 5`.
    await auth.post(U(model.id, '/switch-branch')).send({ name: 'feat' });
    await auth.post(U(model.id, '/checkout')).send({});
    await auth.put(U(model.id)).send({ equations: { entries: { shared: { expression: '20' }, branchOnly: { expression: '5' } } } });
    await auth.post(U(model.id, '/checkin')).send({ message: 'feat eq' });
    return model;
  }

  test('merge requires the caller\'s checkout (REQ 954)', async () => {
    const auth = await authenticatedRequest();
    const model = await divergent(auth);
    const res = await auth.post(U(model.id, '/reconcile')).send({ featureIds: [] });
    expect(res.status).toBe(423);
    const other = await authenticatedRequest(await createTestUser({ displayName: 'Merge Other' }));
    await other.post(U(model.id, '/checkout')).send({});
    expect((await auth.post(U(model.id, '/reconcile')).send({ featureIds: [] })).status).toBe(423);
  });

  test('branch-only variables survive a merge with no equation selection (REQ 955)', async () => {
    const auth = await authenticatedRequest();
    const model = await divergent(auth);
    await auth.post(U(model.id, '/checkout')).send({});
    const res = await auth.post(U(model.id, '/reconcile')).send({ featureIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.equations.entries.branchOnly).toMatchObject({ expression: '5' });
    expect(res.body.equations.entries.shared).toMatchObject({ expression: '10' }); // main's, not selected
  });

  test('selected equation names take the branch version (REQ 955)', async () => {
    const auth = await authenticatedRequest();
    const model = await divergent(auth);
    await auth.post(U(model.id, '/checkout')).send({});
    const res = await auth.post(U(model.id, '/reconcile')).send({ featureIds: [], equationNames: ['shared', 'branchOnly'] });
    expect(res.status).toBe(200);
    expect(res.body.equations.entries.shared).toMatchObject({ expression: '20' });
    expect(res.body.equations.entries.branchOnly).toMatchObject({ expression: '5' });
  });

  test('merge bumps lastContentSavedAt (REQ 954)', async () => {
    const auth = await authenticatedRequest();
    const model = await divergent(auth);
    await auth.post(U(model.id, '/checkout')).send({});
    const before = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;
    const res = await auth.post(U(model.id, '/reconcile')).send({ featureIds: [] });
    expect(new Date(res.body.lastContentSavedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  test('the CAS anchor is the branch head the merge was computed from (REQ 954)', async () => {
    const auth = await authenticatedRequest();
    const model = await divergent(auth);
    await auth.post(U(model.id, '/checkout')).send({});
    const row = await db.DesignCADModel.findByPk(model.id);
    const repo = await cadvcs.repoForModel(row);
    // Another commit lands on the branch AFTER the merged doc was computed
    // (just before the merge commit is written) — the merge must lose (409)
    // rather than discard it.
    const orig = vcs.createCommit;
    jest.spyOn(vcs, 'createCommit').mockImplementationOnce(async (...args) => {
      const head = await vcs.getRef(repo, 'feat');
      const sneak = await orig(repo, { treeHash: (await vcs.getCommit(repo, head.targetHash)).treeHash, parents: [head.targetHash], message: 'sneak', timestamp: new Date().toISOString() });
      await vcs.updateBranch(repo, 'feat', sneak);
      return orig(...args);
    });
    const res = await auth.post(U(model.id, '/reconcile')).send({ featureIds: [] });
    expect(res.status).toBe(409);
    jest.restoreAllMocks();
  });
});

// REQ 969 — behind-main detection stops early and caches (commits are immutable).
describe('isAncestor (REQ 969)', () => {
  const vcs = require('../../../services/vcs/vcsService');
  const REPO = { repoType: 'test-anc', repoId: '1' };

  async function chain(n) {
    const tree = await vcs.writeTree(REPO, []);
    const hashes = [];
    let parent = null;
    for (let i = 0; i < n; i++) {
      parent = await vcs.createCommit(REPO, { treeHash: tree, parents: parent ? [parent] : [], message: `c${i}`, timestamp: new Date(1700000000000 + i).toISOString() });
      hashes.push(parent);
    }
    return hashes;
  }

  test('answers correctly and stops at the ancestor', async () => {
    const h = await chain(30);
    const spy = jest.spyOn(global.db.VcsObject, 'findOne');
    expect(await vcs.isAncestor(REPO, h[28], h[29])).toBe(true);
    expect(spy.mock.calls.length).toBe(1); // read h[29] only, found its parent
    expect(await vcs.isAncestor(REPO, h[29], h[0])).toBe(false);
    spy.mockRestore();
  });

  test('a repeated question is served from the cache with no commit reads', async () => {
    const h = await chain(20);
    expect(await vcs.isAncestor(REPO, h[0], h[19])).toBe(true);
    const spy = jest.spyOn(global.db.VcsObject, 'findOne');
    expect(await vcs.isAncestor(REPO, h[0], h[19])).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
