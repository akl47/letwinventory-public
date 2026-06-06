const { authenticatedRequest, createTestPart } = require('../../helpers');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

describe('Assembly replace-component (REQ 762)', () => {
  it('replaces the part referenced by an instance', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await partWithCad(auth);
    const c2 = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id });

    const res = await auth.put(`/api/design/assembly/${asm.body.id}/instances/i1/replace`).send({ partID: c2.id });
    expect(res.status).toBe(200);
    expect(res.body.instance.partID).toBe(c2.id);
    expect(res.body.assembly.assemblyDoc.instances[0].partID).toBe(c2.id);
  });

  it('rejects replacing with a part that has no CAD model or assembly', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await partWithCad(auth);
    const bare = await createTestPart();
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id });

    const res = await auth.put(`/api/design/assembly/${asm.body.id}/instances/i1/replace`).send({ partID: bare.id });
    expect(res.status).toBe(422);
  });

  it('adds and removes a linear pattern via the API', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id });

    const add = await auth.post(`/api/design/assembly/${asm.body.id}/patterns`).send({ kind: 'linear', seedInstanceId: 'i1', count: 3, spacing: [10, 0, 0] });
    expect(add.status).toBe(201);
    expect(add.body.pattern.patternId).toBe('p1');
    expect(add.body.assembly.assemblyDoc.patterns).toHaveLength(1);

    const del = await auth.delete(`/api/design/assembly/${asm.body.id}/patterns/p1`);
    expect(del.status).toBe(200);
    expect(del.body.assemblyDoc.patterns).toHaveLength(0);
  });

  it('rejects a pattern with a missing seed instance', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const res = await auth.post(`/api/design/assembly/${asm.body.id}/patterns`).send({ kind: 'linear', seedInstanceId: 'iX', count: 2 });
    expect(res.status).toBe(404);
  });
});
