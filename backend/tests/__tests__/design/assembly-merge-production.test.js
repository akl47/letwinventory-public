const { authenticatedRequest, createTestPart } = require('../../helpers');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

describe('Assembly production release + compare + merge (full parity)', () => {
  it('promotes a released assembly to a production letter revision', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 }); // rev "00"
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const id = asm.body.id;
    await auth.post(`/api/design/assembly/${id}/branches`).send({ name: 'd1' });
    await auth.post(`/api/design/assembly/${id}/switch-branch`).send({ name: 'd1' });
    await auth.post(`/api/design/assembly/${id}/release`).send({}); // → main, rev 01, releaseLocked
    await auth.post(`/api/design/assembly/${id}/workflow`).send({ action: 'submit' });
    await auth.post(`/api/design/assembly/${id}/workflow`).send({ action: 'approve' });

    const prod = await auth.post(`/api/design/assembly/${id}/production-release`).send({});
    expect(prod.status).toBe(200);
    expect(prod.body.revision).toBe('A');
    expect(prod.body.prodModelID).toBeDefined();
  });

  it('rejects production without a release', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const res = await auth.post(`/api/design/assembly/${asm.body.id}/production-release`).send({});
    expect(res.status).toBe(409);
  });

  it('diffs two commits, showing component-level changes', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const id = asm.body.id;
    await auth.post(`/api/design/assembly/${id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: comp.id });
    await auth.post(`/api/design/assembly/${id}/checkin`).send({ message: 'add comp' });

    const commits = await auth.get(`/api/design/assembly/${id}/commits`);
    expect(commits.body.length).toBe(2);
    const newest = commits.body[0].hash;
    const oldest = commits.body[1].hash;
    const diff = await auth.get(`/api/design/assembly/${id}/commits/${oldest}/diff/${newest}`);
    expect(diff.status).toBe(200);
    expect(diff.body.entries.some((e) => e.name.startsWith('instance:') && e.status === 'added')).toBe(true);
  });

  it('rejects merge on main and previews no changes there', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const id = asm.body.id;
    const merge = await auth.post(`/api/design/assembly/${id}/reconcile`).send({});
    expect(merge.status).toBe(409);
    const preview = await auth.get(`/api/design/assembly/${id}/reconcile/preview`);
    expect(preview.body.changes).toEqual([]);
  });
});
