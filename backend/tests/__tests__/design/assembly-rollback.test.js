// REQ 1028 — assembly tree rollback bar and drag-reorder.
const svc = require('../../../services/assemblyRegenService');
const { authenticatedRequest, createTestPart } = require('../../helpers');

function stubChild() {
  const tri = { faceId: 'f0', persistentName: 'f0', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
  return { faces: [tri], vertices: [[1, 0, 0]], edges: [], bodies: [{ id: 'b0', name: null, brep: 'B', faces: [tri], vertices: [[1, 0, 0]], edges: [] }] };
}
const placed = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

describe('assembly rollback bar (REQ 1028)', () => {
  const doc = {
    instances: [
      { instanceId: 'i1', partID: 2, grounded: true, placement: placed, createdAt: 100 },
      { instanceId: 'i2', partID: 2, grounded: true, placement: placed, createdAt: 200 },
      { instanceId: 'legacy', partID: 2, grounded: true, placement: placed },
    ],
    patterns: [{ patternId: 'p1', kind: 'linear', seedInstanceId: 'i2', count: 2, spacing: [10, 0, 0] }],
  };

  it('leaves out components created at or after the cutoff, and patterns seeded on them', async () => {
    const assembly = { partID: 1, assemblyDoc: doc, featureTree: { features: [], rollbackAt: 200 } };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances.map((i) => i.instanceId).sort()).toEqual(['i1', 'legacy']);
    expect(composed.errors).toEqual([]);
  });

  it('includes everything when rolled forward', async () => {
    const assembly = { partID: 1, assemblyDoc: doc, featureTree: { features: [], rollbackAt: null } };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances.map((i) => i.instanceId).sort()).toEqual(['i1', 'i2', 'i2#p1_1', 'legacy']);
  });
});

describe('assembly tree reorder (REQ 1028)', () => {
  async function assemblyWithComponent(auth) {
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await createTestPart();
    await auth.post(`/api/design/cad-model/by-part/${comp.id}`).send({});
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/cad-model/${asm.body.id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });
    return asm.body.id;
  }

  it('restamps an instance createdAt', async () => {
    const auth = await authenticatedRequest();
    const id = await assemblyWithComponent(auth);
    const res = await auth.put(`/api/design/assembly/${id}/instances/i1`).send({ createdAt: 12345.5 });
    expect(res.status).toBe(200);
    expect(res.body.instance.createdAt).toBe(12345.5);
  });

  it('rejects a non-numeric createdAt', async () => {
    const auth = await authenticatedRequest();
    const id = await assemblyWithComponent(auth);
    const res = await auth.put(`/api/design/assembly/${id}/instances/i1`).send({ createdAt: 'soon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/createdAt/);
  });
});
