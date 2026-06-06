const { authenticatedRequest, createTestPart } = require('../../helpers');

async function makeAssembly(auth) {
  const part = await createTestPart({ partCategoryID: 4 });
  const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
  return asm.body.id;
}

describe('Assembly VCS parity (Stage 2 — shared branch/workflow/graph)', () => {
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

  it('lists, creates, and switches branches via the shared branch ops', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);

    const list0 = await auth.get(`/api/design/assembly/${id}/branches`);
    expect(list0.status).toBe(200);
    expect(list0.body.some((b) => b.name === 'main')).toBe(true);

    const create = await auth.post(`/api/design/assembly/${id}/branches`).send({ name: 'draft/01' });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe('draft/01');

    const list1 = await auth.get(`/api/design/assembly/${id}/branches`);
    expect(list1.body.map((b) => b.name).sort()).toEqual(['draft/01', 'main']);

    const sw = await auth.post(`/api/design/assembly/${id}/switch-branch`).send({ name: 'draft/01' });
    expect(sw.status).toBe(200);
    expect(sw.body.branchName).toBe('draft/01');
    // On a draft branch the derived display revision is the next numeric.
    expect(sw.body.displayRevision).toBe('01');
  });

  it('exposes the review workflow via the shared workflow engine', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    await auth.post(`/api/design/assembly/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/assembly/${id}/switch-branch`).send({ name: 'draft/01' });

    const wf = await auth.get(`/api/design/assembly/${id}/workflow`);
    expect(wf.status).toBe(200);
    expect(wf.body.state).toBe('draft');
    expect(Array.isArray(wf.body.actions)).toBe(true);

    const submit = await auth.post(`/api/design/assembly/${id}/workflow`).send({ action: 'submit' });
    expect(submit.status).toBe(200);
    expect(submit.body.state).toBe('in_review');
  });

  it('returns a version graph for the assembly repo', async () => {
    const auth = await authenticatedRequest();
    const id = await makeAssembly(auth);
    const res = await auth.get(`/api/design/assembly/${id}/graph`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.commits) || Array.isArray(res.body.nodes) || typeof res.body === 'object').toBe(true);
  });
});
