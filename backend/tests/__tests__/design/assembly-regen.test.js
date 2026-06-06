const svc = require('../../../services/assemblyRegenService');

// A minimal child geometry (one triangular face + one body) for the stub resolver,
// so the composition/scoping/placement logic is tested without a CAD kernel.
function stubChild() {
  const face = {
    persistentName: 'f0', faceId: 'f0',
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
  };
  return {
    faces: [face],
    vertices: [[1, 0, 0]],
    edges: [{ polyline: [[0, 0, 0], [1, 0, 0]] }],
    bodies: [{ id: 'b0', name: null, brep: 'BREP0', faces: [face], vertices: [[1, 0, 0]], edges: [{ polyline: [[0, 0, 0], [1, 0, 0]] }] }],
  };
}

describe('assemblyRegenService.regenerateAssembly (REQ 752)', () => {
  it('composes two instances with instance-scoped body and face ids', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
          { instanceId: 'i2', partID: 3, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });

    expect(composed.bodies.map((b) => b.id)).toEqual(['i1::b0', 'i2::b0']);
    expect(composed.faces.map((f) => f.persistentName)).toEqual(['i1::f0', 'i2::f0']);
    expect(composed.instances).toHaveLength(2);
    expect(composed.errors).toHaveLength(0);
  });

  it('applies the instance translation to composed geometry', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, placement: { translate: [10, 5, -2], quaternion: [0, 0, 0, 1] } },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    // Child vertex [1,0,0] translated by [10,5,-2] → [11,5,-2].
    expect(composed.bodies[0].vertices[0]).toEqual([11, 5, -2]);
  });

  it('applies the instance rotation to composed geometry', async () => {
    const s = Math.sin(Math.PI / 4); // 90° about +z
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, placement: { translate: [0, 0, 0], quaternion: [0, 0, s, s] } },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    // Child vertex [1,0,0] rotated 90° about z → [0,1,0].
    const [x, y, z] = composed.bodies[0].vertices[0];
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('skips suppressed instances', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, suppressed: true },
          { instanceId: 'i2', partID: 3 },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() });
    expect(composed.instances.map((i) => i.instanceId)).toEqual(['i2']);
  });

  it('rejects a circular (self) assembly reference', async () => {
    const assembly = { partID: 5, assemblyDoc: { instances: [{ instanceId: 'i1', partID: 5 }] } };
    await expect(
      svc.regenerateAssembly(assembly, { resolveChild: async () => stubChild() }),
    ).rejects.toThrow(/circular/i);
  });
});

describe('assemblyRegenService.assemblyBom (REQ 753)', () => {
  it('aggregates instances into one line per distinct part with counts', () => {
    const assembly = {
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2 },
          { instanceId: 'i2', partID: 3 },
          { instanceId: 'i3', partID: 2 },
        ],
      },
    };
    expect(svc.assemblyBom(assembly)).toEqual([
      { partID: 2, quantity: 2 },
      { partID: 3, quantity: 1 },
    ]);
  });

  it('excludes suppressed instances from the BOM', () => {
    const assembly = {
      assemblyDoc: { instances: [{ instanceId: 'i1', partID: 2 }, { instanceId: 'i2', partID: 2, suppressed: true }] },
    };
    expect(svc.assemblyBom(assembly)).toEqual([{ partID: 2, quantity: 1 }]);
  });
});
