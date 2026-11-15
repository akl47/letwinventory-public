'use strict';

// Harness version control (REQ 1062–1066): the CAD workflow in the harness
// backend — checkout / check-in, draft branches off a protected main, release
// to a numeric revision, approval-gated production release, and adoption of
// harnesses that predate version control.

const { authenticatedRequest, createTestHarness, createTestPart } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');

const url = (id, p = '') => `/api/parts/harness/${id}${p}`;
const repoOf = (id) => ({ repoType: 'harness', repoId: String(id) });
const DATA = (label = 'J1') => ({
  connectors: [{ id: 'conn-1', label, position: { x: 0, y: 0 } }], cables: [], components: [], connections: [],
});

async function createHarness(auth, body = {}) {
  const res = await auth.post('/api/parts/harness').send({ name: 'VC Harness', harnessData: {}, ...body });
  expect(res.status).toBe(201);
  return res.body;
}
// A harness with one checked-in commit on its draft branch, lock released.
async function checkedIn(auth, label = 'J1') {
  const h = await createHarness(auth);
  await auth.post(url(h.id, '/checkout'));
  await auth.put(url(h.id)).send({ harnessData: DATA(label) });
  const res = await auth.post(url(h.id, '/checkin')).send({ message: 'first' });
  expect(res.status).toBe(200);
  return res.body.model;
}
async function released(auth) {
  const h = await checkedIn(auth);
  const res = await auth.post(url(h.id, '/release'));
  expect(res.status).toBe(200);
  return res.body.model;
}

describe('Harness version control', () => {
  // REQ 1062
  describe('checkout and check-in', () => {
    it('creates a harness on a draft branch with an empty main', async () => {
      const auth = await authenticatedRequest();
      const h = await createHarness(auth);
      expect(h.branchName).toBe('draft/01');
      expect(h.revision).toBe('01');
      expect(h.released).toBe(false);
      expect(h.dirty).toBe(false);
      expect(await vcs.getRef(repoOf(h.id), 'main')).toBeTruthy();
    });

    it('refuses a content save without a checkout', async () => {
      const auth = await authenticatedRequest();
      const h = await createHarness(auth);
      const res = await auth.put(url(h.id)).send({ harnessData: DATA() });
      expect(res.status).toBe(423);
      expect(res.body.error).toMatch(/Check out/);
    });

    it('saves while checked out, then commits on check-in and releases the lock', async () => {
      const auth = await authenticatedRequest();
      const h = await createHarness(auth);
      expect((await auth.post(url(h.id, '/checkout'))).body.lockedByUserID).toBe(auth.user.id);
      const saved = await auth.put(url(h.id)).send({ harnessData: DATA() });
      expect(saved.status).toBe(200);
      expect(saved.body.dirty).toBe(true);

      const res = await auth.post(url(h.id, '/checkin')).send({ message: 'add J1' });
      expect(res.status).toBe(200);
      expect(res.body.model.dirty).toBe(false);
      expect(res.body.model.lockedByUserID).toBeNull();

      const commits = await auth.get(url(h.id, '/commits'));
      expect(commits.body[0].message).toBe('add J1');
      const doc = await auth.get(url(h.id, `/commits/${res.body.commitHash}/doc`));
      expect(doc.body.harnessData.connectors[0].label).toBe('J1');
    });

    it('blocks a second user while the harness is checked out', async () => {
      const auth = await authenticatedRequest();
      const other = await authenticatedRequest(await createTestUser({ displayName: 'Second User' }));
      const h = await createHarness(auth);
      await auth.post(url(h.id, '/checkout'));
      expect((await other.post(url(h.id, '/checkout'))).status).toBe(423);
      const save = await other.put(url(h.id)).send({ harnessData: DATA() });
      expect(save.status).toBe(423);
      expect(save.body.error).toMatch(/checked out by/);
    });

    it('undo checkout discards uncommitted changes', async () => {
      const auth = await authenticatedRequest();
      const h = await checkedIn(auth, 'J1');
      await auth.post(url(h.id, '/checkout'));
      await auth.put(url(h.id)).send({ harnessData: DATA('J2') });
      const res = await auth.post(url(h.id, '/undo-checkout'));
      expect(res.status).toBe(200);
      expect(res.body.harnessData.connectors[0].label).toBe('J1');
      expect(res.body.dirty).toBe(false);
      expect(res.body.lockedByUserID).toBeNull();
    });

    it('rejects a save carrying a stale save token', async () => {
      const auth = await authenticatedRequest();
      const h = await createHarness(auth);
      await auth.post(url(h.id, '/checkout'));
      const first = await auth.put(url(h.id)).send({ harnessData: DATA('J1'), clientSavedAt: null });
      expect(first.status).toBe(200);
      const stale = await auth.put(url(h.id)).send({ harnessData: DATA('J2'), clientSavedAt: null });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('DOC_CONFLICT');
      const ok = await auth.put(url(h.id)).send({ harnessData: DATA('J3'), clientSavedAt: first.body.lastContentSavedAt });
      expect(ok.status).toBe(200);
    });

    it('reports uncommitted element changes in the working diff', async () => {
      const auth = await authenticatedRequest();
      const h = await checkedIn(auth, 'J1');
      await auth.post(url(h.id, '/checkout'));
      await auth.put(url(h.id)).send({ harnessData: DATA('J2') });
      const diff = await auth.get(url(h.id, '/working-diff'));
      expect(diff.status).toBe(200);
      const entry = diff.body.entries.find((e) => e.name === 'connector:conn-1');
      expect(entry.status).toBe('modified');
      expect(entry.displayName).toBe('Connector J2');
    });
  });

  // REQ 1063
  describe('branches', () => {
    it('protects main: no checkout and no save on a released harness', async () => {
      const auth = await authenticatedRequest();
      const h = await released(auth);
      expect(h.branchName).toBe('main');
      expect((await auth.post(url(h.id, '/checkout'))).status).toBe(423);
      expect((await auth.put(url(h.id)).send({ harnessData: DATA('X') })).status).toBe(423);
    });

    it('creates and switches to a draft branch carrying the next revision', async () => {
      const auth = await authenticatedRequest();
      const h = await released(auth);
      expect((await auth.post(url(h.id, '/branches')).send({ name: 'draft/02' })).status).toBe(200);
      const res = await auth.post(url(h.id, '/switch-branch')).send({ name: 'draft/02' });
      expect(res.status).toBe(200);
      expect(res.body.branchName).toBe('draft/02');
      expect(res.body.revision).toBe('02');
      expect(res.body.releaseState).toBe('draft');
      expect(res.body.released).toBe(false);
      expect(res.body.behindMain).toBe(false);
      const names = (await auth.get(url(h.id, '/branches'))).body.map((b) => b.name);
      expect(names).toEqual(expect.arrayContaining(['main', 'draft/02']));
    });

    it('refuses to switch branches with uncommitted changes and archives a spare branch', async () => {
      const auth = await authenticatedRequest();
      const h = await checkedIn(auth);
      await auth.post(url(h.id, '/branches')).send({ name: 'experiment' });
      await auth.post(url(h.id, '/checkout'));
      await auth.put(url(h.id)).send({ harnessData: DATA('J2') });
      expect((await auth.post(url(h.id, '/switch-branch')).send({ name: 'experiment' })).status).toBe(409);
      expect((await auth.delete(url(h.id, '/branches/experiment'))).status).toBe(200);
      expect((await auth.delete(url(h.id, '/branches/main'))).status).toBe(409);
    });
  });

  // REQ 1064
  describe('release', () => {
    it('releases a checked-in branch as revision 01, tags it and archives the branch', async () => {
      const auth = await authenticatedRequest();
      const h = await checkedIn(auth);
      const res = await auth.post(url(h.id, '/release'));
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('01');
      expect(res.body.model).toMatchObject({ branchName: 'main', releaseState: 'released', released: true, releaseLocked: true, revision: '01' });
      expect((await vcs.getRef(repoOf(h.id), '01')).targetHash).toBe(res.body.commitHash);
      expect(await vcs.getRef(repoOf(h.id), 'draft/01')).toBeNull();
    });

    it('numbers the next release 02 and keeps the first tag untouched', async () => {
      const auth = await authenticatedRequest();
      const h = await released(auth);
      const first = (await vcs.getRef(repoOf(h.id), '01')).targetHash;
      await auth.post(url(h.id, '/branches')).send({ name: 'draft/02' });
      await auth.post(url(h.id, '/switch-branch')).send({ name: 'draft/02' });
      await auth.post(url(h.id, '/checkout'));
      await auth.put(url(h.id)).send({ harnessData: DATA('J2') });
      await auth.post(url(h.id, '/checkin')).send({ message: 'second' });
      const res = await auth.post(url(h.id, '/release'));
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('02');
      expect((await vcs.getRef(repoOf(h.id), '01')).targetHash).toBe(first);
    });

    it('refuses to release uncommitted changes or an already released revision', async () => {
      const auth = await authenticatedRequest();
      const h = await checkedIn(auth);
      await auth.post(url(h.id, '/checkout'));
      await auth.put(url(h.id)).send({ harnessData: DATA('J2') });
      const dirty = await auth.post(url(h.id, '/release'));
      expect(dirty.status).toBe(409);
      expect(dirty.body.error).toMatch(/Check in/);
      await auth.post(url(h.id, '/checkin')).send({ message: 'x' });
      expect((await auth.post(url(h.id, '/release'))).status).toBe(200);
      expect((await auth.post(url(h.id, '/release'))).status).toBe(409);
    });

    it('refuses to release while a sub-harness is unreleased, naming it', async () => {
      const auth = await authenticatedRequest();
      const child = await createHarness(auth, { name: 'Child Loom' });
      const parent = await createHarness(auth, { name: 'Parent Loom' });
      await auth.post(url(parent.id, '/checkout'));
      await auth.put(url(parent.id)).send({
        harnessData: { ...DATA(), subHarnesses: [{ id: 'sub-1', harnessId: child.id, position: { x: 0, y: 0 } }] },
      });
      await auth.post(url(parent.id, '/checkin')).send({ message: 'with child' });
      const res = await auth.post(url(parent.id, '/release'));
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Child Loom');
    });
  });

  // REQ 1065
  describe('review workflow and production release', () => {
    it('requires an independent approval of the released commit before a production release', async () => {
      const auth = await authenticatedRequest();
      const reviewer = await authenticatedRequest(await createTestUser({ displayName: 'Reviewer' }));
      const h = await released(auth);

      expect((await auth.post(url(h.id, '/production-release'))).status).toBe(409);

      const submitted = await auth.post(url(h.id, '/workflow')).send({ action: 'submit' });
      expect(submitted.body.state).toBe('in_review');
      const self = await auth.post(url(h.id, '/workflow')).send({ action: 'approve' });
      expect(self.status).toBe(403);
      const approved = await reviewer.post(url(h.id, '/workflow')).send({ action: 'approve' });
      expect(approved.body.state).toBe('approved');

      const res = await reviewer.post(url(h.id, '/production-release'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ revision: 'A', sourceRevision: '01' });
      const repo = repoOf(h.id);
      expect((await vcs.getRef(repo, 'A')).targetHash).toBe((await vcs.getRef(repo, '01')).targetHash);
      expect((await auth.get(url(h.id, '/workflow'))).body.state).toBe('draft');
    });

    it('rejects approval by a user without the harness approve permission', async () => {
      const auth = await authenticatedRequest();
      const h = await released(auth);
      await auth.post(url(h.id, '/workflow')).send({ action: 'submit' });
      const limited = await authenticatedRequest(await createTestUser({ displayName: 'Limited' }), { grantPermissions: false });
      const perm = await db.Permission.findOne({ where: { resource: 'harness', action: 'read' } });
      await db.UserPermission.create({ userID: limited.user.id, permissionID: perm.id });
      expect((await limited.post(url(h.id, '/workflow')).send({ action: 'approve' })).status).toBe(403);
      expect((await limited.post(url(h.id, '/production-release'))).status).toBe(403);
    });
  });

  // REQ 1068 — the editor URL is keyed by part
  describe('harness of a part', () => {
    it('returns the most recently updated harness of the part, adopted', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const older = await createTestHarness({ name: 'Older', partID: part.id });
      const newer = await createTestHarness({ name: 'Newer', partID: part.id });
      await db.WireHarness.update({ updatedAt: new Date(Date.now() - 60000) }, { where: { id: older.id }, silent: true });
      const res = await auth.get(`/api/parts/harness/by-part/${part.id}/active`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(newer.id);
      expect(res.body.branchName).toBe('draft/01');
    });

    it('returns 404 for a part with no harness', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      expect((await auth.get(`/api/parts/harness/by-part/${part.id}/active`)).status).toBe(404);
    });
  });

  // REQ 1066
  describe('harnesses from before version control', () => {
    it('adopts a released harness as the released main line tagged with its revision', async () => {
      const auth = await authenticatedRequest();
      const legacy = await createTestHarness({ name: 'Legacy Released', revision: '03', releaseState: 'released', harnessData: DATA() });
      const res = await auth.get(url(legacy.id));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ branchName: 'main', released: true, releaseLocked: true, revision: '03', dirty: false });
      expect(await vcs.getRef(repoOf(legacy.id), '03')).toBeTruthy();
      expect(res.body.harnessData.connectors[0].label).toBe('J1');
    });

    it('adopts a draft harness as a draft branch with its content uncommitted', async () => {
      const auth = await authenticatedRequest();
      const legacy = await createTestHarness({ name: 'Legacy Draft', revision: '02', releaseState: 'review', harnessData: DATA() });
      const res = await auth.get(url(legacy.id));
      expect(res.body).toMatchObject({ branchName: 'draft/02', released: false, revision: '02', releaseState: 'draft', dirty: true });
      expect(res.body.harnessData.connectors[0].label).toBe('J1');

      await auth.post(url(legacy.id, '/checkout'));
      await auth.post(url(legacy.id, '/checkin')).send({ message: 'adopt' });
      const rel = await auth.post(url(legacy.id, '/release'));
      expect(rel.body.revision).toBe('02');
    });
  });
});
