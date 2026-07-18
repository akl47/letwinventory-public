'use strict';

// REQ 901 — VCS mutation atomicity:
//   - updateBranch compare-and-swap rejects a stale expected head (lost-update
//     protection for concurrent check-ins/releases);
//   - checkin is transactional: a failure after the commit object is written
//     rolls the whole verb back (no orphan commit, model row untouched);
//   - createTag joins an ambient CLS transaction (a rollback removes the tag,
//     so a failed production release can't strand a write-once tag);
//   - loadFrozenGeometry fails loudly on a missing referenced object instead
//     of reconstructing silently-empty geometry.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');
const cadVcs = require('../../../services/vcs/cadVcsService');
const cadFreeze = require('../../../services/vcs/cadFreezeService');

const REPO = { repoType: 'test-atomicity', repoId: '1' };

async function commitOn(parents, label) {
  const tree = await vcs.writeTree(REPO, [{ name: label, kind: 'blob', hash: await vcs.writeBlob(REPO, { label }) }]);
  return vcs.createCommit(REPO, { treeHash: tree, parents, message: label, timestamp: new Date().toISOString() });
}

describe('VCS atomicity (REQ 901)', () => {
  test('updateBranch CAS: stale expected head rejects and leaves the ref unmoved', async () => {
    const c1 = await commitOn([], 'c1');
    const c2 = await commitOn([c1], 'c2');
    const c3 = await commitOn([c1], 'c3');
    await vcs.createBranch(REPO, 'cas-branch', c1);

    await vcs.updateBranch(REPO, 'cas-branch', c2, null, undefined, c1); // c1 → c2 with correct expectation
    await expect(vcs.updateBranch(REPO, 'cas-branch', c3, null, undefined, c1)) // stale: head is c2 now
      .rejects.toMatchObject({ code: 'REF_MOVED' });
    expect((await vcs.getRef(REPO, 'cas-branch')).targetHash).toBe(c2);

    // Without expectedHash the legacy unconditional move still works.
    await vcs.updateBranch(REPO, 'cas-branch', c3);
    expect((await vcs.getRef(REPO, 'cas-branch')).targetHash).toBe(c3);
  });

  test('checkin rolls back atomically when the ref advance fails', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'M' });
    const model = await db.DesignCADModel.findByPk(created.body.id);
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await model.reload();
    await model.update({ dirty: true });

    const objectsBefore = await db.VcsObject.count();
    const baseBefore = model.baseCommitHash;

    const spy = jest.spyOn(vcs, 'updateBranch').mockRejectedValueOnce(new Error('injected ref failure'));
    try {
      await expect(cadVcs.checkin(model, model.lockedByUserID, 'atomic test'))
        .rejects.toThrow('injected ref failure');
    } finally {
      spy.mockRestore();
    }

    await model.reload();
    // Rollback: the commit object created before the failure is gone, and the
    // working copy still reads dirty on its old base.
    expect(await db.VcsObject.count()).toBe(objectsBefore);
    expect(model.dirty).toBe(true);
    expect(model.baseCommitHash).toBe(baseBefore);
  });

  test('createTag inside an ambient transaction rolls back with it', async () => {
    const c1 = await commitOn([], 'tagged');
    await expect(db.sequelize.transaction(async () => {
      await vcs.createTag(REPO, 'doomed-tag', c1); // no db/txn arg — CLS must bind it
      throw new Error('abort release');
    })).rejects.toThrow('abort release');
    expect(await vcs.getRef(REPO, 'doomed-tag')).toBeNull();
  });

  test('loadFrozenGeometry throws on a missing mesh snapshot object', async () => {
    await expect(cadFreeze.loadFrozenGeometry(REPO, { meshHash: 'f'.repeat(64), bodies: [] }))
      .rejects.toThrow(/missing its mesh snapshot/);
  });

  test('loadFrozenGeometry throws on a missing body BRep object', async () => {
    const meshHash = await vcs.writeBlob(REPO, { bodies: [] });
    await expect(cadFreeze.loadFrozenGeometry(REPO, {
      meshHash,
      bodies: [{ bodyId: 'b1', brepHash: 'e'.repeat(64) }],
    })).rejects.toThrow(/missing the BRep object for body b1/);
  });
});
