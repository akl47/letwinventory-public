const svc = require('../../../services/assemblyRegenService');

function stubChild() {
  const tri = { faceId: 'f0', persistentName: 'f0', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
  return { faces: [tri], vertices: [[1, 0, 0]], edges: [], bodies: [{ id: 'b0', name: null, brep: 'B', faces: [tri], vertices: [[1, 0, 0]], edges: [] }] };
}

describe('assembly component patterns (REQ 760/761)', () => {
  it('linear pattern produces N placed copies at the expected offsets', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
        patterns: [{ patternId: 'p1', kind: 'linear', seedInstanceId: 'i1', count: 3, spacing: [10, 0, 0] }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances.map((i) => i.instanceId)).toEqual(['i1', 'i1#p1_1', 'i1#p1_2']);
    // Seed vertex [1,0,0] copied at x-offsets 0, 10, 20 → x = 1, 11, 21.
    expect(composed.bodies.map((b) => b.vertices[0][0])).toEqual([1, 11, 21]);
  });

  it('circular pattern places copies rotated about the axis', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [5, 0, 0], quaternion: [0, 0, 0, 1] } }],
        patterns: [{ patternId: 'p1', kind: 'circular', seedInstanceId: 'i1', count: 4, axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], angleStep: Math.PI / 2 }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances).toHaveLength(4);
    // First copy rotated 90° about z: seed vertex world [6,0,0] → [0,6,0].
    const v = composed.bodies[1].vertices[0];
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(6, 6);
  });

  it('mirror reflects vertices across the plane and reverses winding', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [5, 0, 0], quaternion: [0, 0, 0, 1] } }],
        patterns: [{ patternId: 'p1', kind: 'mirror', seedInstanceId: 'i1', planeOrigin: [0, 0, 0], planeNormal: [1, 0, 0] }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances.map((i) => i.instanceId)).toEqual(['i1', 'i1#p1m']);
    // Seed vertex world [6,0,0] reflected across x=0 → [-6,0,0].
    expect(composed.bodies[1].vertices[0][0]).toBeCloseTo(-6, 6);
    // Triangle winding reversed: [0,1,2] → [0,2,1].
    expect(Array.from(composed.bodies[1].faces[0].indices)).toEqual([0, 2, 1]);
  });

  it('mirror copies carry the reflection plane for kernel-side baking (REQ 856)', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [5, 0, 0], quaternion: [0, 0, 0, 1] } }],
        patterns: [{ patternId: 'p1', kind: 'mirror', seedInstanceId: 'i1', planeOrigin: [1, 2, 3], planeNormal: [0, 1, 0] }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    // Export/interference bake rotate → translate → mirror from these fields —
    // without `mirror`, the copy would be placed as the unmirrored seed.
    const seedBody = composed.bodies[0];
    const mirrorBody = composed.bodies[1];
    expect(seedBody.mirror).toBeNull();
    expect(mirrorBody.mirror).toEqual({ origin: [1, 2, 3], normal: [0, 1, 0] });
    // The mirror copy keeps the SEED's rigid placement; the reflection is a
    // separate world-space step applied after it.
    expect(mirrorBody.placement).toEqual({ translate: [5, 0, 0], quaternion: [0, 0, 0, 1] });
  });

  it('records an error when a pattern references a missing seed', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [{ instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
        patterns: [{ patternId: 'p1', kind: 'linear', seedInstanceId: 'iX', count: 3, spacing: [10, 0, 0] }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.errors.some((e) => /seed instance iX/.test(e))).toBe(true);
    expect(composed.instances).toHaveLength(1); // only the base instance
  });
});
