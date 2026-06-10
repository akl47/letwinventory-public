const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const { assemblySerialize, assemblyDeserialize } = require('../../../services/vcs/assemblySerializer');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

describe('assemblySerializer round-trip (REQ — VCS binding)', () => {
  it('serializes and reconstructs an identical assembly document', async () => {
    const repo = { repoType: 'assembly', repoId: 'rt-test' };
    const doc = {
      nextInstanceSeq: 3, nextMateSeq: 2,
      instances: [
        { instanceId: 'i1', partID: 5, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
        { instanceId: 'i2', partID: 6, placement: { translate: [1, 2, 3], quaternion: [0, 0, 0, 1] } },
      ],
      mates: [
        { mateId: 'm1', id: 'm1', type: 'coincident', a: { instanceId: 'i1', faceId: 'f0' }, b: { instanceId: 'i2', faceId: 'f1' } },
      ],
    };
    const tree = await assemblySerialize(repo, doc, db);
    const back = await assemblyDeserialize(repo, tree, db);
    expect(back).toEqual(doc);
  });

  it('shares structure — re-serializing identical content yields the same tree hash', async () => {
    const repo = { repoType: 'assembly', repoId: 'rt-test2' };
    const doc = { nextInstanceSeq: 1, nextMateSeq: 1, instances: [], mates: [] };
    const a = await assemblySerialize(repo, doc, db);
    const b = await assemblySerialize(repo, doc, db);
    expect(a).toBe(b);
  });
});

describe('Assembly version control (REQ 750 VCS — unified cad-model surface)', () => {
  it('seeds an initial commit on create', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    expect(asm.body.baseCommitHash).toBeTruthy();

    const commits = await auth.get(`/api/design/cad-model/${asm.body.id}/commits`);
    expect(commits.status).toBe(200);
    expect(commits.body.length).toBe(1);
  });

  it('checkout → insert → checkin creates a commit; undo-checkout rolls back', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await partWithCad(auth);
    const c2 = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const id = asm.body.id;

    // `main` is protected on the unified surface — work on a draft branch.
    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });

    const co = await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
    expect(co.status).toBe(200);
    expect(co.body.lockedByUserID).toBe(auth.user.id);

    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c1.id });
    const ci = await auth.post(`/api/design/cad-model/${id}/checkin`).send({ message: 'add comp1' });
    expect(ci.status).toBe(200);
    expect(ci.body.commitHash).toBeTruthy();

    const commits = await auth.get(`/api/design/cad-model/${id}/commits`);
    expect(commits.body.length).toBe(2); // initial + checkin

    // Check-in released the lock; check out again, add a second component, then
    // undo — it should roll back to the checked-in state.
    await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c2.id });
    const undo = await auth.post(`/api/design/cad-model/${id}/undo-checkout`).send({});
    expect(undo.status).toBe(200);
    expect(undo.body.assemblyDoc.instances).toHaveLength(1); // comp2 discarded
    expect(undo.body.lockedByUserID).toBeNull();
  });

  it('rejects check-in without holding the lock', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const res = await auth.post(`/api/design/cad-model/${asm.body.id}/checkin`).send({ message: 'x' });
    expect(res.status).toBe(423);
  });
});
