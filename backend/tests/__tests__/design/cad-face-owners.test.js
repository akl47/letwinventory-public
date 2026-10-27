// REQ 892 — SolidWorks-style face OWNERSHIP. The kernel re-tags every face of
// a boolean result under the composing feature, so the regen service carries
// per-face ownership geometrically: result faces matching a previous body
// face's centroid+normal inherit that face's owner; everything else belongs
// to the composing feature. Selecting a feature then highlights only ITS
// faces, not the whole body.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadRegenService = require('../../../services/cadRegenService');
const cadKernelClient = require('../../../services/cadKernelClient');

const { _carryFaceOwners } = cadRegenService;

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
  it('a result face matching a previous face inherits its owner', () => {
    const prev = [face('a', [0, 0, 0]), face('b', [5, 0, 0])];
    const prevOwners = { a: 'f2', b: 'f2' };
    const next = [face('a2', [0, 0, 0]), face('new', [9, 9, 9])];
    const owners = _carryFaceOwners(prev, prevOwners, next, 'f3');
    expect(owners).toEqual({ a2: 'f2', new: 'f3' });
  });

  it('ownership chains across multiple carries', () => {
    const gen1 = _carryFaceOwners([], null, [face('a', [0, 0, 0])], 'f2');
    const gen2 = _carryFaceOwners([face('a', [0, 0, 0])], gen1, [face('a2', [0, 0, 0]), face('n', [7, 0, 0])], 'f3');
    const gen3 = _carryFaceOwners(
      [face('a2', [0, 0, 0]), face('n', [7, 0, 0])], gen2,
      [face('a3', [0, 0, 0]), face('n2', [7, 0, 0]), face('blend', [3, 3, 3])], 'f4');
    expect(gen3).toEqual({ a3: 'f2', n2: 'f3', blend: 'f4' });
  });

  it('an opposite-facing face at the same centroid does NOT match (normal gate)', () => {
    const prev = [face('top', [0, 0, 5], [0, 0, 1])];
    const owners = _carryFaceOwners(prev, { top: 'f2' }, [face('bottom', [0, 0, 5], [0, 0, -1])], 'f3');
    expect(owners.bottom).toBe('f3');
  });

  it('a symmetrically-trimmed face (same centroid, smaller mesh) keeps its creator', () => {
    // The classic case: a concentric hole turns a disk into a ring — the
    // centroid and normal survive, so the ring stays with the base feature.
    const prev = [face('disk', [0, 0, 10], [0, 0, 1], 5)];
    const owners = _carryFaceOwners(prev, { disk: 'f2' }, [face('ring', [0, 0, 10], [0, 0, 1], 2)], 'f3');
    expect(owners.ring).toBe('f2');
  });

  it('with no previous faces, everything belongs to the composing feature', () => {
    const owners = _carryFaceOwners([], null, [face('a', [0, 0, 0]), face('b', [5, 0, 0])], 'f2');
    expect(owners).toEqual({ a: 'f2', b: 'f2' });
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
  const BASE_FACES = [face('base-cap', [0, 0, 20]), face('base-side', [10, 0, 10], [1, 0, 0])];
  // Boolean (cut) result: the cap + side SURVIVE at the same centroids; the
  // bore wall is NEW.
  const BOOL_FACES = [
    face('cut-cap', [0, 0, 20]),
    face('cut-side', [10, 0, 10], [1, 0, 0]),
    face('cut-bore', [0, 0, 10], [0, 1, 0]),
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
