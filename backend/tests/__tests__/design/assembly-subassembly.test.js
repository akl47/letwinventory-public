const svc = require('../../../services/assemblyRegenService');

describe('subassembly nesting (REQ 763)', () => {
  it('composes a referenced sub-assembly under the parent instance scope', async () => {
    // What a sub-assembly's regenerateAssembly would return for its one instance "si".
    const tri = { faceId: 'si::f', persistentName: 'si::f', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
    const subComposed = {
      faces: [tri], vertices: [[2, 0, 0]], edges: [],
      bodies: [{ id: 'si::sb', name: null, brep: 'B', faces: [tri], vertices: [[2, 0, 0]], edges: [] }],
    };
    const parent = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'pi', partID: 2, ref: { kind: 'assembly' }, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
      },
    };
    const composed = await svc.regenerateAssembly(parent, { resolveChild: async () => subComposed });
    // The sub-assembly body id is re-scoped under the parent instance.
    expect(composed.bodies[0].id).toBe('pi::si::sb');
    expect(composed.bodies[0].vertices[0]).toEqual([2, 0, 0]);
  });

  it('rejects a cyclic nesting (A contains B contains A)', async () => {
    // Fake db: part 1 (parent) contains part 2, which contains part 1 → a cycle.
    const assemblyByPart = {
      1: { partID: 1, assemblyDoc: { instances: [{ instanceId: 'pi', partID: 2 }] } },
      2: { partID: 2, assemblyDoc: { instances: [{ instanceId: 'x', partID: 1 }] } },
    };
    const db = { DesignAssembly: { findOne: async ({ where }) => assemblyByPart[where.partID] || null } };

    await expect(svc.assertAcyclic(assemblyByPart[1], db)).rejects.toThrow(/circular/i);
  });
});
