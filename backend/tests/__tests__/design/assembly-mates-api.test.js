const { authenticatedRequest, createTestPart } = require('../../helpers');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

// Build an assembly with two component instances; returns { auth, asmId, i1, i2 }.
async function twoComponentAssembly() {
  const auth = await authenticatedRequest();
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const c1 = await partWithCad(auth);
  const c2 = await partWithCad(auth);
  const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
  await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id });
  await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c2.id });
  return { auth, asmId: asm.body.id };
}

describe('Assembly mate API (REQ 758)', () => {
  it('adds a mate between two instances', async () => {
    const { auth, asmId } = await twoComponentAssembly();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i2', faceId: 'fb' },
    });
    expect(res.status).toBe(201);
    expect(res.body.mate.mateId).toBe('m1');
    expect(res.body.mate.type).toBe('coincident');
    expect(res.body.assembly.assemblyDoc.mates).toHaveLength(1);
  });

  it('removes a mate', async () => {
    const { auth, asmId } = await twoComponentAssembly();
    await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'concentric', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i2', faceId: 'fb' },
    });
    const res = await auth.delete(`/api/design/assembly/${asmId}/mates/m1`);
    expect(res.status).toBe(200);
    expect(res.body.assemblyDoc.mates).toHaveLength(0);
  });

  it('rejects a mate referencing an unknown instance', async () => {
    const { auth, asmId } = await twoComponentAssembly();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i9', faceId: 'fb' },
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown mate type', async () => {
    const { auth, asmId } = await twoComponentAssembly();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'glue', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i2', faceId: 'fb' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a mate between an instance and itself', async () => {
    const { auth, asmId } = await twoComponentAssembly();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i1', faceId: 'fb' },
    });
    expect(res.status).toBe(400);
  });

  // Full mate edit (reopening the create sidebar): type + surfaces + value/flip
  // are all editable in place via PUT.
  describe('updateMate (full edit)', () => {
    async function withMate() {
      const ctx = await twoComponentAssembly();
      await ctx.auth.post(`/api/design/assembly/${ctx.asmId}/mates`).send({
        type: 'coincident', a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i2', faceId: 'fb' }, flip: false,
      });
      return ctx;
    }
    const mateOf = (body) => body.assemblyDoc.mates[0];

    it('still edits value + flip only', async () => {
      const { auth, asmId } = await withMate();
      const res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({ value: 5, flip: true });
      expect(res.status).toBe(200);
      expect(mateOf(res.body)).toMatchObject({ type: 'coincident', value: 5, flip: true });
    });

    it('changes the mate type in place', async () => {
      const { auth, asmId } = await withMate();
      const res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({ type: 'parallel' });
      expect(res.status).toBe(200);
      expect(mateOf(res.body).type).toBe('parallel');
    });

    it('re-targets the two surfaces', async () => {
      const { auth, asmId } = await withMate();
      const res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({
        a: { instanceId: 'i2', faceId: 'xy_plane' }, b: { instanceId: 'i1', faceId: 'yz_plane' },
      });
      expect(res.status).toBe(200);
      expect(mateOf(res.body).a).toEqual({ instanceId: 'i2', faceId: 'xy_plane' });
      expect(mateOf(res.body).b).toEqual({ instanceId: 'i1', faceId: 'yz_plane' });
    });

    it('rejects an unknown type', async () => {
      const { auth, asmId } = await withMate();
      const res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({ type: 'glue' });
      expect(res.status).toBe(400);
    });

    it('rejects re-targeting onto the same instance', async () => {
      const { auth, asmId } = await withMate();
      const res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({
        a: { instanceId: 'i1', faceId: 'fa' }, b: { instanceId: 'i1', faceId: 'fb' },
      });
      expect(res.status).toBe(400);
    });
  });
});
