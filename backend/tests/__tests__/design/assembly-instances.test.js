const { authenticatedRequest, createTestPart } = require('../../helpers');

// Create a part that has a CAD model (so it can be inserted as a component).
async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

describe('Assembly component instances (REQ 751)', () => {
  it('inserts a component instance referencing a part with a CAD model', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    const res = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });

    expect(res.status).toBe(201);
    expect(res.body.instance.instanceId).toBe('i1');
    expect(res.body.instance.partID).toBe(comp.id);
    expect(res.body.instance.grounded).toBe(true); // first component auto-grounded
    expect(res.body.assembly.assemblyDoc.instances).toHaveLength(1);
  });

  it('inserts the same part twice as two distinct instances', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    const a = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });
    const b = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } });

    expect(a.body.instance.instanceId).toBe('i1');
    expect(b.body.instance.instanceId).toBe('i2');
    expect(b.body.instance.grounded).toBe(false); // second is floating
    expect(b.body.instance.placement.translate).toEqual([10, 0, 0]);
    expect(b.body.assembly.assemblyDoc.instances).toHaveLength(2);
  });

  it('updates an instance placement', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });

    const res = await auth.put(`/api/design/assembly/${asm.body.id}/instances/i1`)
      .send({ placement: { translate: [1, 2, 3], quaternion: [0, 0, 0, 1] } });

    expect(res.status).toBe(200);
    expect(res.body.instance.placement.translate).toEqual([1, 2, 3]);
  });

  it('removes an instance', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });

    const res = await auth.delete(`/api/design/assembly/${asm.body.id}/instances/i1`);
    expect(res.status).toBe(200);
    expect(res.body.assemblyDoc.instances).toHaveLength(0);
  });

  it('rejects inserting a non-existent part', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    const res = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: 999999 });
    expect(res.status).toBe(404);
  });

  it('rejects inserting a part that has no CAD model or assembly', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const bare = await createTestPart(); // no CAD model
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    const res = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: bare.id });
    expect(res.status).toBe(422);
  });

  it('rejects a circular reference (inserting the assembly’s own part)', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    // asmPart has an assembly (itself), so it passes the has-geometry gate but is cyclic.
    const res = await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: asmPart.id });
    expect(res.status).toBe(409);
  });
});
