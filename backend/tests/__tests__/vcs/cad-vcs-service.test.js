'use strict';

// Phase 1 — checkout / check-in / lock over the working copy.
// Covers REQ 677 (VC-9 dirty/branch/base), 678 (VC-10 423), 679 (VC-11 release/
// sweep), 680 (VC-12 commit chain), 683 (VC-15 version stamp). DB-backed.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const cadvcs = require('../../../services/vcs/cadVcsService');
const vcs = require('../../../services/vcs/vcsService');
const { NAMING_VERSION } = require('../../../services/cadRegenService');

async function makeModel(uid) {
  const part = await createTestPart();
  return db.DesignCADModel.create({
    partID: part.id,
    revision: 'A',
    featureTree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 },
    sketchDoc: { sketches: {}, nextSketchSeq: 1 },
    equations: { entries: {} },
    releaseState: 'draft',
    createdByUserID: uid,
    activeFlag: true,
  });
}

describe('cadVcsService — checkout / check-in / lock', () => {
  let uid; // the authenticated user's id (auto-increments; not always 1)
  beforeEach(async () => { uid = (await authenticatedRequest()).user.id; });

  test('checkout acquires the lock; check-in commits and advances the branch', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    expect(model.lockedByUserID).toBe(uid);

    const { commitHash } = await cadvcs.checkin(model, uid, 'first');
    expect(commitHash).toBeTruthy();
    expect(model.dirty).toBe(false);
    expect(model.baseCommitHash).toBe(commitHash);

    const repo = await cadvcs.repoForModel(model);
    expect((await vcs.getRef(repo, 'main')).targetHash).toBe(commitHash);
  });

  test('a second check-in chains onto the first (DAG)', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    const r1 = await cadvcs.checkin(model, uid, 'one');
    await model.update({
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 },
    });
    const r2 = await cadvcs.checkin(model, uid, 'two');
    expect(r2.commitHash).not.toBe(r1.commitHash);
    const commit = await vcs.getCommit(await cadvcs.repoForModel(model), r2.commitHash);
    expect(commit.parents).toEqual([r1.commitHash]);
  });

  test('check-in requires the lock', async () => {
    const model = await makeModel(uid); // not checked out
    await expect(cadvcs.checkin(model, uid, 'x')).rejects.toMatchObject({ statusCode: 423 });
  });

  test('a second user is blocked while the lock is held (423)', async () => {
    const bob = await db.User.create({ googleID: 'g-bob', displayName: 'Bob', email: 'bob@example.com', activeFlag: true });
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    await expect(cadvcs.checkout(model, bob.id, {})).rejects.toMatchObject({ statusCode: 423 });
  });

  test('an expired lock no longer blocks another user', async () => {
    const cara = await db.User.create({ googleID: 'g-cara', displayName: 'Cara', email: 'cara@example.com', activeFlag: true });
    const t0 = new Date('2026-06-01T00:00:00Z');
    const model = await cadvcs.checkout(await makeModel(uid), uid, { lockTtlMs: 1000, at: t0 });
    const m2 = await cadvcs.checkout(model, cara.id, { at: new Date(t0.getTime() + 5000) });
    expect(m2.lockedByUserID).toBe(cara.id);
  });

  test('releaseLock: holder releases; non-holder cannot; admin force can', async () => {
    const dee = await db.User.create({ googleID: 'g-dee', displayName: 'Dee', email: 'dee@example.com', activeFlag: true });
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    await expect(cadvcs.releaseLock(model, dee.id, {})).rejects.toMatchObject({ statusCode: 423 });
    await cadvcs.releaseLock(model, dee.id, { force: true });
    expect(model.lockedByUserID).toBeNull();
  });

  test('sweepExpiredLocks clears stale locks', async () => {
    const t0 = new Date('2026-06-01T00:00:00Z');
    const model = await cadvcs.checkout(await makeModel(uid), uid, { lockTtlMs: 1000, at: t0 });
    const cleared = await cadvcs.sweepExpiredLocks(new Date(t0.getTime() + 5000));
    expect(cleared).toBe(1);
    await model.reload();
    expect(model.lockedByUserID).toBeNull();
  });

  test('markDirty flags uncommitted edits; check-in clears it', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    await cadvcs.markDirty(model);
    expect(model.dirty).toBe(true);
    await cadvcs.checkin(model, uid, 'commit');
    expect(model.dirty).toBe(false);
  });

  test('every commit is stamped with the kernel + naming version (VC-15)', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    const { commitHash } = await cadvcs.checkin(model, uid, 'v');
    const commit = await vcs.getCommit(await cadvcs.repoForModel(model), commitHash);
    expect(commit.meta.namingVersion).toBe(NAMING_VERSION);
    expect(commit.meta.kernelVersion).toBeTruthy();
  });

  test('undoCheckout discards changes, rolls back to the last check-in, and unlocks', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    await cadvcs.checkin(model, uid, 'base'); // base = origin only
    await model.update({
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 9 }], nextFeatureSeq: 3 },
      dirty: true,
    });
    expect(model.featureTree.features).toHaveLength(2);

    await cadvcs.undoCheckout(model, uid);
    expect(model.featureTree.features.map(f => f.id)).toEqual(['f1']); // rolled back
    expect(model.dirty).toBe(false);
    expect(model.lockedByUserID).toBeNull();
  });

  test('undoCheckout requires holding the lock', async () => {
    const model = await makeModel(uid); // not checked out
    await expect(cadvcs.undoCheckout(model, uid)).rejects.toMatchObject({ statusCode: 423 });
  });

  // Regression: a second release of the same revision must fail BEFORE mutating
  // anything. Otherwise the branch advances past the tagged commit and orphans a
  // duplicate `release N` commit, which corrupts the history graph (the released
  // HEAD ends up buried under untagged duplicates).
  test('re-releasing the same revision is rejected without advancing the branch', async () => {
    const cadKernelClient = require('../../../services/cadKernelClient');
    const stub = { call: jest.fn().mockResolvedValue({
      brepBytes: 'BREP', faces: [], topology: { vertices: [], edges: [] },
    }) };
    const spy = jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
    try {
      const model = await cadvcs.checkout(await makeModel(uid), uid, {});
      await cadvcs.checkin(model, uid, 'base');

      const first = await cadvcs.release(model, uid, '00', {});
      const repo = await cadvcs.repoForModel(model);
      expect((await vcs.getRef(repo, '00')).targetHash).toBe(first.commitHash);
      expect((await vcs.getRef(repo, 'main')).targetHash).toBe(first.commitHash);

      // Second release: 409, and the branch head + tag stay on the first commit.
      await expect(cadvcs.release(model, uid, '00', {})).rejects.toMatchObject({ statusCode: 409 });
      expect((await vcs.getRef(repo, 'main')).targetHash).toBe(first.commitHash);
      expect((await vcs.getRef(repo, '00')).targetHash).toBe(first.commitHash);
    } finally {
      spy.mockRestore();
    }
  });
});
