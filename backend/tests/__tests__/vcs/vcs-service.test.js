'use strict';

// Phase 0 VCS kernel — content-addressed object store + refs.
// Covers REQ 669 (VC-1 dedup), 671 (VC-3 blob/tree/commit), 672 (VC-4 commit
// DAG), 673 (VC-5 branches/tags), 674 (VC-6 log), 675 (VC-7 binary), 676
// (VC-8 component reference). DB-backed (SQLite via tests/setup.js).

const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');

const REPO = { repoType: 'test', repoId: '1' };
const OTHER = { repoType: 'test', repoId: '2' };
const T = '2026-06-01T00:00:00.000Z';

async function objCount(repo, hash) {
  return db.VcsObject.count({ where: { repoType: repo.repoType, repoId: repo.repoId, hash } });
}

describe('vcsService — content addressing + dedup (VC-1)', () => {
  test('identical content stores one row and the same hash, regardless of key order', async () => {
    const a = await vcs.writeBlob(REPO, { feature: 'extrude', distance: 10 });
    const b = await vcs.writeBlob(REPO, { distance: 10, feature: 'extrude' }); // reordered keys
    expect(b).toBe(a);
    expect(await objCount(REPO, a)).toBe(1);
  });

  test('different content yields distinct hashes', async () => {
    const a = await vcs.writeBlob(REPO, { distance: 10 });
    const b = await vcs.writeBlob(REPO, { distance: 11 });
    expect(b).not.toBe(a);
  });
});

describe('vcsService — object kinds blob/tree/commit (VC-3)', () => {
  test('blob/tree/commit round-trip preserves content and entry order', async () => {
    const h1 = await vcs.writeBlob(REPO, { id: 'f1' });
    const h2 = await vcs.writeBlob(REPO, { id: 'f2' });

    const treeHash = await vcs.writeTree(REPO, [
      { name: 'feature:f1', kind: 'blob', hash: h1 },
      { name: 'feature:f2', kind: 'blob', hash: h2 },
    ]);
    const entries = await vcs.readTree(REPO, treeHash);
    expect(entries.map((e) => e.name)).toEqual(['feature:f1', 'feature:f2']);
    expect(entries[0]).toMatchObject({ name: 'feature:f1', kind: 'blob', hash: h1 });

    const commitHash = await vcs.createCommit(REPO, {
      treeHash, parents: [], authorUserID: 1, message: 'init', timestamp: T,
      meta: { kernelVersion: 'k1', namingVersion: 20 },
    });
    const commit = await vcs.getObject(REPO, commitHash);
    expect(commit.kind).toBe('commit');
    expect(commit.content.treeHash).toBe(treeHash);
    expect(commit.content.meta).toEqual({ kernelVersion: 'k1', namingVersion: 20 });
  });
});

describe('vcsService — commit DAG (VC-4)', () => {
  test('commit hash covers parents; parents are recorded; commits chain', async () => {
    const treeHash = await vcs.writeTree(REPO, []);
    const c1 = await vcs.createCommit(REPO, { treeHash, parents: [], authorUserID: 1, message: 'a', timestamp: T });
    const withParent = await vcs.createCommit(REPO, { treeHash, parents: [c1], authorUserID: 1, message: 'a', timestamp: T });
    const noParent = await vcs.createCommit(REPO, { treeHash, parents: [], authorUserID: 1, message: 'a', timestamp: T });

    // Same tree/message/author/timestamp — differ ONLY by parent => different hash.
    expect(withParent).not.toBe(noParent);
    const commit = await vcs.getObject(REPO, withParent);
    expect(commit.content.parents).toEqual([c1]);
  });
});

describe('vcsService — refs: branches + tags (VC-5)', () => {
  test('branches are mutable, tags are write-once, refs are isolated per repo', async () => {
    const treeHash = await vcs.writeTree(REPO, []);
    const c1 = await vcs.createCommit(REPO, { treeHash, parents: [], authorUserID: 1, message: '1', timestamp: T });
    const c2 = await vcs.createCommit(REPO, { treeHash, parents: [c1], authorUserID: 1, message: '2', timestamp: T });

    await vcs.createBranch(REPO, 'main', c1);
    await vcs.updateBranch(REPO, 'main', c2); // mutable
    expect((await vcs.getRef(REPO, 'main')).targetHash).toBe(c2);

    await vcs.createTag(REPO, 'A', c1);
    await expect(vcs.createTag(REPO, 'A', c2)).rejects.toThrow(); // write-once
    expect((await vcs.getRef(REPO, 'A')).targetHash).toBe(c1);

    // Isolation: a different repo does not see this repo's refs.
    expect(await vcs.getRef(OTHER, 'main')).toBeNull();
  });
});

describe('vcsService — history traversal (VC-6)', () => {
  test('log walks ancestry from a ref newest -> oldest', async () => {
    const treeHash = await vcs.writeTree(REPO, []);
    const c1 = await vcs.createCommit(REPO, { treeHash, parents: [], authorUserID: 1, message: '1', timestamp: T });
    const c2 = await vcs.createCommit(REPO, { treeHash, parents: [c1], authorUserID: 1, message: '2', timestamp: T });
    const c3 = await vcs.createCommit(REPO, { treeHash, parents: [c2], authorUserID: 1, message: '3', timestamp: T });
    await vcs.createBranch(REPO, 'main', c3);

    const hist = await vcs.log(REPO, 'main');
    expect(hist.map((h) => h.hash)).toEqual([c3, c2, c1]);
  });
});

describe('vcsService — binary objects (VC-7)', () => {
  test('binary objects dedup by byte content and round-trip intact', async () => {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const h1 = await vcs.putBinary(REPO, 'geometry', bytes);
    const h2 = await vcs.putBinary(REPO, 'geometry', Buffer.from([1, 2, 3, 4, 5]));
    expect(h2).toBe(h1);
    expect(await objCount(REPO, h1)).toBe(1);

    const obj = await vcs.getObject(REPO, h1);
    expect(obj.kind).toBe('geometry');
    expect(Buffer.compare(obj.bytes, bytes)).toBe(0);
  });
});

describe('vcsService — component reference seam (VC-8)', () => {
  test('a tree containing a component entry round-trips and records the child ref', async () => {
    const childCommit = 'a'.repeat(64); // a pinned child commit hash
    const compHash = await vcs.putObject(REPO, {
      kind: 'component',
      content: { childRepoType: 'cad', childRepoId: '42', instanceId: 'i1', ref: { commitHash: childCommit } },
    });
    const treeHash = await vcs.writeTree(REPO, [
      { name: 'component:i1', kind: 'component', hash: compHash },
    ]);

    const entries = await vcs.readTree(REPO, treeHash);
    expect(entries[0]).toMatchObject({ name: 'component:i1', kind: 'component', hash: compHash });

    const comp = await vcs.getObject(REPO, compHash);
    expect(comp.kind).toBe('component');
    expect(comp.content.childRepoId).toBe('42');
    expect(comp.content.ref.commitHash).toBe(childCommit);
  });
});
