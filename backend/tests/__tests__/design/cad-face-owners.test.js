// REQ 892 — SolidWorks-style face OWNERSHIP: selecting a feature highlights
// only the faces it created. Since REQ 1035 the kernel keeps a face's name
// through every later op, so the creator is the root of the name (the pattern
// feature for an instance copy); faces without a structured name fall back to
// the composing feature.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadRegenService = require('../../../services/cadRegenService');
const cadKernelClient = require('../../../services/cadKernelClient');

const { _carryFaceOwners } = cadRegenService;

const name = (featureId, role, extra = {}) => JSON.stringify({ feature_id: featureId, role, sub_index: 0, ...extra, upstream_refs: [] });

/** A fake tessellated face: one triangle centered near `center`, facing `normal`. */
function face(id, center, normal = [0, 0, 1], size = 1) {
  const [cx, cy, cz] = center;
  return {
    faceId: id,
    persistentName: id,
    isFlat: true,
    positions: [
      cx - size, cy - size, cz,
      cx + size, cy - size, cz,
      cx, cy + 2 * size, cz,
    ],
    normals: [normal[0], normal[1], normal[2], normal[0], normal[1], normal[2], normal[0], normal[1], normal[2]],
    indices: [0, 1, 2],
  };
}

describe('_carryFaceOwners (unit)', () => {
  it('a face is owned by the root feature of its name', () => {
    const owners = _carryFaceOwners([], null, [
      face(name('f2#m0', 'cap-top'), [0, 0, 0]),
      face(name('f3#body', 'new'), [5, 0, 0]),
      face(name('f4', 'offset'), [9, 0, 0]),
    ], 'f9');
    expect(Object.values(owners)).toEqual(['f2', 'f3', 'f4']);
  });

  it('an instance copy belongs to the pattern feature that made it', () => {
    const id = name('f2#0', 'side', { instance: 'f7#2/f5#1' });
    expect(_carryFaceOwners([], null, [face(id, [0, 0, 0])], 'f9')[id]).toBe('f7');
  });

  it('unstructured ids fall back to the composing feature', () => {
    expect(_carryFaceOwners([], null, [face('raw', [0, 0, 0])], 'f3')).toEqual({ raw: 'f3' });
  });
});

// ── Integration: ownership flows through the regenerate route ──────────────

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

function fakeCircleSketch(sketchId, radius = 10) {
  return {
    id: sketchId,
    hostId: 'datum:xy_plane',
    plane: XY_PLANE,
    state: {
      entities: [
        { kind: 'point', id: `pc-${sketchId}`, x: 0, y: 0 },
        { kind: 'circle', id: `c-${sketchId}`, centerId: `pc-${sketchId}`, radius },
      ],
      constraints: [],
    },
    candidates: [],
  };
}

describe('regenerate carries face ownership across a cut (REQ 892)', () => {
  // The base extrude's prism faces (become the seeded body):
  const BASE_FACES = [face(name('f2#0', 'cap-top'), [0, 0, 20]), face(name('f2#0', 'side'), [10, 0, 10], [1, 0, 0])];
  // Boolean (cut) result: the cap + side keep their names; the bore wall is
  // the cut tool's side face.
  const BOOL_FACES = [
    BASE_FACES[0],
    BASE_FACES[1],
    face(name('f3#0', 'side', { body: 'f2' }), [0, 0, 10], [0, 1, 0]),
  ];

  let kernelStub;
  beforeEach(() => {
    kernelStub = { calls: [] };
    kernelStub.call = jest.fn().mockImplementation((method, params) => {
      if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
      kernelStub.calls.push({ method, params });
      if (method === 'buildExtrude') {
        const isBase = String(params.featureId).startsWith('f2');
        return Promise.resolve({
          brepBytes: 'brep',
          faces: isBase ? BASE_FACES : [face('tool', [0, 0, 10])],
          topology: { vertices: [], edges: [] },
        });
      }
      if (method === 'buildBoolean') {
        return Promise.resolve({
          brepBytes: 'brep2',
          faces: BOOL_FACES,
          topology: { vertices: [], edges: [] },
          solids: [{
            brepBytes: 'brep2', centroid: [0, 0, 10], volume: 100,
            faces: BOOL_FACES, topology: { vertices: [], edges: [] },
          }],
        });
      }
      if (method === 'bodyVolume') return Promise.resolve({ volume: 100 });
      return Promise.resolve({ brepBytes: '', faces: [], topology: { vertices: [], edges: [] } });
    });
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(kernelStub);
  });
  afterEach(() => jest.restoreAllMocks());

  it('surviving faces stay owned by the base extrude; the bore belongs to the cut', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Owners' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});

    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 },
        { id: 'f3', type: 'cutExtrude', sketchId: 's2', distance: 20 },
      ],
      nextFeatureSeq: 4,
    };
    const doc = { sketches: { s1: fakeCircleSketch('s1', 10), s2: fakeCircleSketch('s2', 3) }, nextSketchSeq: 3 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);

    const cutResult = res.body.features.find(f => f.featureId === 'f3');
    expect(cutResult).toBeTruthy();
    expect(cutResult.faceOwners).toBeTruthy();

    // Resolve owners through the (body-scoped) faceIds of the returned faces,
    // identifying each face by its first vertex position.
    const ownerOf = (x, y, z) => {
      const f = cutResult.faces.find(fc =>
        Math.abs(fc.positions[0] - x) < 1e-9 && Math.abs(fc.positions[1] - y) < 1e-9 && Math.abs(fc.positions[2] - z) < 1e-9);
      expect(f).toBeTruthy();
      return cutResult.faceOwners[f.faceId];
    };
    // BASE_FACES survive → owned by the base extrude f2.
    expect(ownerOf(-1, -1, 20)).toBe('f2');   // cap (first vertex of face at [0,0,20])
    expect(ownerOf(9, -1, 10)).toBe('f2');    // side
    // The bore wall is new → owned by the cut f3.
    expect(ownerOf(-1, -1, 10)).toBe('f3');
  });
});
