'use strict';

// REQ 902 — VCS object garbage collection: unreachable objects older than the
// grace window are swept; everything reachable from refs (including frozen
// geometry referenced only from commit meta) and everything recent survives.

const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');
const gc = require('../../../services/vcs/vcsGcService');

const REPO = { repoType: 'test-gc', repoId: '9' };

async function ageObject(hash, days) {
  await db.VcsObject.update(
    { createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    { where: { repoType: REPO.repoType, repoId: REPO.repoId, hash } },
  );
}

async function objectExists(hash) {
  return (await db.VcsObject.count({
    where: { repoType: REPO.repoType, repoId: REPO.repoId, hash },
  })) === 1;
}

describe('VCS garbage collection (REQ 902)', () => {
  test('sweeps old unreachable objects, keeps ref-reachable and recent ones', async () => {
    // Reachable chain: blob → tree → commit ← branch ref.
    const blob = await vcs.writeBlob(REPO, { keep: 'me' });
    const tree = await vcs.writeTree(REPO, [{ name: 'a', kind: 'blob', hash: blob }]);
    const commit = await vcs.createCommit(REPO, { treeHash: tree, parents: [], message: 'kept', timestamp: new Date().toISOString() });
    await vcs.createBranch(REPO, 'main', commit);

    // Frozen geometry referenced only from commit meta on a tagged release.
    const brep = await vcs.putBinary(REPO, 'geometry', Buffer.from('BREP-BYTES'));
    const mesh = await vcs.writeBlob(REPO, { bodies: [] });
    const releaseCommit = await vcs.createCommit(REPO, {
      treeHash: tree, parents: [commit], message: 'release',
      timestamp: new Date().toISOString(),
      meta: { frozen: { meshHash: mesh, bodies: [{ bodyId: 'b1', brepHash: brep }] } },
    });
    await vcs.createTag(REPO, '01', releaseCommit);

    // Unreachable: an old dangling blob and a recent dangling blob.
    const oldDangling = await vcs.writeBlob(REPO, { orphaned: 'long ago' });
    const newDangling = await vcs.writeBlob(REPO, { orphaned: 'just now' });

    // Age everything reachable AND the old dangling object past the grace
    // window — reachability, not age, must be what saves the kept objects.
    for (const h of [blob, tree, commit, brep, mesh, releaseCommit, oldDangling]) {
      await ageObject(h, 30);
    }

    const deleted = await gc.sweepRepo(REPO.repoType, REPO.repoId, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), [], db);

    expect(deleted).toBe(1);
    expect(await objectExists(oldDangling)).toBe(false);
    expect(await objectExists(newDangling)).toBe(true); // inside grace window
    for (const h of [blob, tree, commit, brep, mesh, releaseCommit]) {
      expect(await objectExists(h)).toBe(true);
    }
  });

  test('extra seeds (working-copy base commits) keep otherwise-unreferenced commits', async () => {
    const tree = await vcs.writeTree(REPO, [{ name: 'x', kind: 'blob', hash: await vcs.writeBlob(REPO, { x: 1 }) }]);
    const floating = await vcs.createCommit(REPO, { treeHash: tree, parents: [], message: 'no ref points here', timestamp: new Date().toISOString() });
    await ageObject(floating, 30);
    await ageObject(tree, 30);

    const cutoff = new Date(); // everything old is a candidate
    await gc.sweepRepo(REPO.repoType, REPO.repoId, cutoff, [floating], db);
    expect(await objectExists(floating)).toBe(true);
    expect(await objectExists(tree)).toBe(true); // reachable from the seeded commit
  });

  test('sweepUnreachableObjects walks every repo and returns a total', async () => {
    const dangling = await vcs.writeBlob(REPO, { another: 'orphan' });
    await ageObject(dangling, 30);
    const total = await gc.sweepUnreachableObjects({ graceDays: 7, db });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(await objectExists(dangling)).toBe(false);
  });
});
