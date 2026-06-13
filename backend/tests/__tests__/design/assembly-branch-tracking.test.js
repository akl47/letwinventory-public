const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const { resolveChildSource } = require('../../../services/assemblyRegenService');
const vcsService = require('../../../services/vcs/vcsService');
const cadVcsService = require('../../../services/vcs/cadVcsService');

// REQ 788/789 — per-instance branch tracking + pin-at-check-in.

async function partWithCad(auth) {
  const part = await createTestPart();
  const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return { part, model: res.body };
}

describe('resolveChildSource — branch selection (REQ 788)', () => {
  it('uses the live working copy when the instance tracks no branch (legacy)', async () => {
    const auth = await authenticatedRequest();
    const { part } = await partWithCad(auth);
    const src = await resolveChildSource({ instanceId: 'i1', partID: part.id }, db);
    expect(src.source).toBe('working');
    expect(src.row.partID).toBe(part.id);
  });

  it('uses the live working copy when the tracked branch is the checked-out branch', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    const row = await db.DesignCADModel.findByPk(model.id);
    const current = row.branchName || 'main';
    const src = await resolveChildSource(
      { instanceId: 'i1', partID: part.id, ref: { kind: 'cad', branch: current } }, db,
    );
    expect(src.source).toBe('working');
  });

  it('materializes the branch-head commit doc when tracking a different branch', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    const row = await db.DesignCADModel.findByPk(model.id);
    // New part CAD models start on a draft branch with `main` seeded — tracking
    // `main` (not the checked-out branch) must resolve main's head commit.
    expect(row.branchName).not.toBe('main');
    const src = await resolveChildSource(
      { instanceId: 'i1', partID: part.id, ref: { kind: 'cad', branch: 'main' } }, db,
    );
    expect(src.source).toBe('commit');
    expect(src.branch).toBe('main');
    expect(src.commitHash).toBeTruthy();
    expect(src.doc).toBeTruthy();
    const repo = await cadVcsService.repoForModel(row, db);
    const mainRef = await vcsService.getRef(repo, 'main', db);
    expect(src.commitHash).toBe(mainRef.targetHash);
  });

  it('falls back to main when the tracked branch no longer exists', async () => {
    const auth = await authenticatedRequest();
    const { part } = await partWithCad(auth);
    const src = await resolveChildSource(
      { instanceId: 'i1', partID: part.id, ref: { kind: 'cad', branch: 'draft/99-gone' } }, db,
    );
    expect(src.source).toBe('commit');
    expect(src.branch).toBe('main');
    expect(src.fellBack).toBe(true);
  });

  it('resolves across the part revision lineage after a release moves the model', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    // Simulate a release: mint the next Parts revision and move the CAD model
    // row to it (what releaseBranchToMain does), leaving the instance pointing
    // at the OLD Parts row.
    const newPart = await db.Part.create({
      ...part.toJSON(), id: undefined, revision: '02', previousRevisionID: part.id,
      createdAt: undefined, updatedAt: undefined,
    });
    await db.DesignCADModel.update({ partID: newPart.id }, { where: { id: model.id } });
    const src = await resolveChildSource({ instanceId: 'i1', partID: part.id }, db);
    expect(src.source).toBe('working');
    expect(src.row.id).toBe(model.id);
    expect(src.row.partID).toBe(newPart.id);
  });

  it('throws 422 when the part has no design anywhere in its lineage', async () => {
    const orphan = await createTestPart();
    await expect(resolveChildSource({ instanceId: 'i1', partID: orphan.id }, db))
      .rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('insert + update carry the tracked branch (REQ 788)', () => {
  it('stores ref.branch on insert and allows changing it via updateInstance', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const { part } = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const id = asm.body.id;

    const ins = await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: part.id, branch: 'main' });
    expect(ins.status).toBe(201);
    expect(ins.body.instance.ref.branch).toBe('main');

    const upd = await auth.put(`/api/design/assembly/${id}/instances/${ins.body.instance.instanceId}`)
      .send({ branch: 'draft/01' });
    expect(upd.status).toBe(200);
    expect(upd.body.instance.ref.branch).toBe('draft/01');
  });
});

describe('assembly check-in pins instance branch heads (REQ 789)', () => {
  it('writes pinnedCommitHash per instance and a VcsUsage edge on check-in', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const { part, model } = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const id = asm.body.id;

    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: part.id, branch: 'main' });
    const ci = await auth.post(`/api/design/cad-model/${id}/checkin`).send({ message: 'pin test' });
    expect(ci.status).toBe(200);

    // The committed doc carries the pinned child commit (= child main head).
    const row = await db.DesignCADModel.findByPk(id);
    const inst = row.assemblyDoc.instances[0];
    const childRow = await db.DesignCADModel.findByPk(model.id);
    const childRepo = await cadVcsService.repoForModel(childRow, db);
    const mainRef = await vcsService.getRef(childRepo, 'main', db);
    expect(inst.pinnedCommitHash).toBe(mainRef.targetHash);

    // VcsUsage edge: assembly commit → child repo.
    const usage = await db.VcsUsage.findOne({
      where: { parentRepoType: 'assembly', parentCommitHash: ci.body.commitHash, instanceId: inst.instanceId },
    });
    expect(usage).toBeTruthy();
    expect(usage.childRepoType).toBe('cad');
    expect(usage.childRepoId).toBe(childRepo.repoId);
  });
});
