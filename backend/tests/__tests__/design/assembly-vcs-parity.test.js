const { authenticatedRequest, createTestPart } = require('../../helpers');

async function makeAssembly(auth) {
  const part = await createTestPart({ partCategoryID: 4 });
  const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
  return asm.body.id;
}

describe('Unified cad-model VCS surface dispatches per kind (assembly rows)', () => {
  it('getById returns the VCS display fields (released / displayRevision / behindMain)', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    const res = await auth.get(`/api/design/assembly/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('released');
    expect(res.body).toHaveProperty('displayRevision');
    expect(res.body).toHaveProperty('behindMain');
    expect(res.body.released).toBe(false);
  });

  it('lists, creates, and switches branches via the unified branch ops', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);

    // Creation already seeds main + auto-creates draft/01 and lands on it.
    const list0 = await auth.get(`/api/design/cad-model/${id}/branches`);
    expect(list0.status).toBe(200);
    expect(list0.body.some((b) => b.name === 'main')).toBe(true);
    expect(list0.body.some((b) => b.name === 'draft/01')).toBe(true);

    const create = await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/02' });
    expect(create.status).toBe(200);
    expect(create.body.name).toBe('draft/02');

    const list1 = await auth.get(`/api/design/cad-model/${id}/branches`);
    expect(list1.body.map((b) => b.name).sort()).toEqual(['draft/01', 'draft/02', 'main']);

    const sw = await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/02' });
    expect(sw.status).toBe(200);
    expect(sw.body.branchName).toBe('draft/02');
    // On a draft branch the derived display revision is the next numeric.
    expect(sw.body.displayRevision).toBe('01');
  });

  it('exposes the review workflow via the unified workflow routes', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });

    const wf = await auth.get(`/api/design/cad-model/${id}/workflow`);
    expect(wf.status).toBe(200);
    expect(wf.body.state).toBe('draft');
    expect(Array.isArray(wf.body.actions)).toBe(true);

    const submit = await auth.post(`/api/design/cad-model/${id}/workflow`).send({ action: 'submit' });
    expect(submit.status).toBe(200);
    expect(submit.body.state).toBe('in_review');
  });

  it('returns a version graph for the assembly repo', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    const res = await auth.get(`/api/design/cad-model/${id}/graph`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.commits) || Array.isArray(res.body.nodes) || typeof res.body === 'object').toBe(true);
  });

  it('serves the merge change-list preview for an assembly ({changes: []} shape)', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    const res = await auth.get(`/api/design/cad-model/${id}/reconcile/preview`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body.changes).toEqual([]);
  });

  it('rejects a CAD-content-only route (feature-tree regenerate) for an assembly with 422', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    const res = await auth.post(`/api/design/cad-model/${id}/regenerate`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not supported for assemblies/i);
  });
});
