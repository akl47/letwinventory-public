const svc = require('../../../services/assemblyRegenService');

const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };

// A block whose top/bottom faces carry analytic plane surfaces (child local frame).
function stubBlock() {
  return {
    faces: [], vertices: [], edges: [],
    bodies: [{
      id: 'b0', name: null, brep: 'BREP',
      faces: [
        { faceId: 'top', persistentName: 'top', ...tri, surface: { kind: 'plane', origin: [0, 0, 10], normal: [0, 0, 1] } },
        { faceId: 'bot', persistentName: 'bot', ...tri, surface: { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] } },
      ],
      vertices: [[0, 0, 0]], edges: [],
    }],
  };
}

// A part with a cylindrical bore whose face carries an axis surface.
function stubBore() {
  return {
    faces: [], vertices: [], edges: [],
    bodies: [{
      id: 'b0', name: null, brep: 'BREP',
      faces: [{ faceId: 'bore', persistentName: 'bore', ...tri, surface: { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 3 } }],
      vertices: [[0, 0, 0]], edges: [],
    }],
  };
}

describe('assembly mate solving in regen (REQ 755)', () => {
  it('coincident mate moves a floating component onto a grounded face', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
          { instanceId: 'i2', partID: 3, placement: { translate: [7, 3, 30], quaternion: [0, 0, 0, 1] } },
        ],
        mates: [
          { id: 'm1', mateId: 'm1', type: 'coincident', a: { instanceId: 'i1', faceId: 'top' }, b: { instanceId: 'i2', faceId: 'bot' } },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubBlock() });
    const i2 = composed.instances.find((i) => i.instanceId === 'i2');
    expect(i2.placement.translate[2]).toBeCloseTo(10, 2); // bottom face lands on the grounded top
    expect(composed.constraintState.state).toBe('under');
    expect(composed.constraintState.dof).toBe(3);
  });

  it('concentric mate aligns two component axes coaxially', async () => {
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
          { instanceId: 'i2', partID: 3, placement: { translate: [5, 5, 0], quaternion: [0, 0, 0, 1] } },
        ],
        mates: [
          { id: 'm1', mateId: 'm1', type: 'concentric', a: { instanceId: 'i1', faceId: 'bore' }, b: { instanceId: 'i2', faceId: 'bore' } },
        ],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => stubBore() });
    const i2 = composed.instances.find((i) => i.instanceId === 'i2');
    expect(i2.placement.translate[0]).toBeCloseTo(0, 2);
    expect(i2.placement.translate[1]).toBeCloseTo(0, 2);
  });

  it('records a clear error and still composes when a mate face has no surface', async () => {
    const noSurface = { faces: [], vertices: [], edges: [], bodies: [{ id: 'b0', name: null, faces: [{ faceId: 'f0', persistentName: 'f0', ...tri }], vertices: [], edges: [] }] };
    const assembly = {
      partID: 1,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
          { instanceId: 'i2', partID: 3, placement: { translate: [0, 0, 5], quaternion: [0, 0, 0, 1] } },
        ],
        mates: [{ id: 'm1', mateId: 'm1', type: 'coincident', a: { instanceId: 'i1', faceId: 'f0' }, b: { instanceId: 'i2', faceId: 'f0' } }],
      },
    };
    const composed = await svc.regenerateAssembly(assembly, { resolveChild: async () => noSurface });
    expect(composed.errors.some((e) => /surface/i.test(e))).toBe(true);
    expect(composed.bodies.length).toBe(2); // still renders both components
  });
});
