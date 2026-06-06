const { authenticatedRequest, createTestPart } = require('../../helpers');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

// Assembly with two components placed apart so explode offsets are nonzero.
async function spreadAssembly() {
  const auth = await authenticatedRequest();
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const c1 = await partWithCad(auth);
  const c2 = await partWithCad(auth);
  const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
  const id = asm.body.id;
  await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c1.id, placement: { translate: [-10, 0, 0], quaternion: [0, 0, 0, 1] } });
  await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c2.id, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } });
  return { auth, id };
}

describe('Assembly exploded views (REQ 764)', () => {
  it('auto-explode computes nonzero radial offsets and persists them', async () => {
    const { auth, id } = await spreadAssembly();
    const res = await auth.post(`/api/design/assembly/${id}/explode/auto`).send({ spread: 1.5 });
    expect(res.status).toBe(200);
    // Components at ±10 about centroid 0 → offsets ±15.
    expect(res.body.explode.offsets['i1'][0]).toBeCloseTo(-15, 5);
    expect(res.body.explode.offsets['i2'][0]).toBeCloseTo(15, 5);
    // Persisted on the assembly.
    expect(res.body.assembly.assemblyDoc.explode.offsets['i2'][0]).toBeCloseTo(15, 5);
  });

  it('sets the explode factor (clamped 0..1)', async () => {
    const { auth, id } = await spreadAssembly();
    const res = await auth.put(`/api/design/assembly/${id}/explode`).send({ factor: 0.5 });
    expect(res.status).toBe(200);
    expect(res.body.explode.factor).toBe(0.5);

    const clamp = await auth.put(`/api/design/assembly/${id}/explode`).send({ factor: 5 });
    expect(clamp.body.explode.factor).toBe(1);
  });
});

describe('Assembly display states (REQ 765)', () => {
  it('saves the current visibility, applies it, and deletes it', async () => {
    const { auth, id } = await spreadAssembly();
    // Hide i2.
    await auth.put(`/api/design/assembly/${id}/instances/i2`).send({ visible: false });

    const save = await auth.post(`/api/design/assembly/${id}/display-states`).send({ name: 'Frame only' });
    expect(save.status).toBe(201);
    expect(save.body.state.id).toBe('ds1');
    expect(save.body.state.hidden).toEqual(['i2']);

    // Reveal i2, then apply the state — i2 should hide again.
    await auth.put(`/api/design/assembly/${id}/instances/i2`).send({ visible: true });
    const apply = await auth.post(`/api/design/assembly/${id}/display-states/ds1/apply`).send({});
    expect(apply.status).toBe(200);
    const i2 = apply.body.assemblyDoc.instances.find((i) => i.instanceId === 'i2');
    expect(i2.visible).toBe(false);

    const del = await auth.delete(`/api/design/assembly/${id}/display-states/ds1`);
    expect(del.status).toBe(200);
    expect(del.body.assemblyDoc.displayStates).toHaveLength(0);
  });

  it('rejects saving a display state without a name', async () => {
    const { auth, id } = await spreadAssembly();
    const res = await auth.post(`/api/design/assembly/${id}/display-states`).send({});
    expect(res.status).toBe(400);
  });
});
