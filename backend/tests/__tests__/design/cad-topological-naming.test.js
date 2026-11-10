// REQs 1035–1039 — stable topological naming, backend side: regen reports
// legacy → stable id migrations, and references saved with legacy positional
// ids keep resolving (the kernel emits `legacyId` next to each stable id).

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const TOP = '{"feature_id":"f2#0","role":"cap-top","sub_index":0,"upstream_refs":[]}';
const LEGACY_TOP = '{"feature_id":"f2#0","role":"cap-top","sub_index":0,"upstream_refs":[]}';
const WALL = '{"feature_id":"f2#0","role":"side","sub_index":0,"upstream_refs":["l1"]}';
const LEGACY_WALL = '{"feature_id":"f2#0","role":"side","sub_index":3,"upstream_refs":[]}';

function face(id, legacyId, z, normal) {
  return {
    faceId: id, persistentName: id, legacyId, isFlat: true,
    positions: [-1, -1, z, 1, -1, z, 0, 2, z],
    normals: [...normal, ...normal, ...normal],
    indices: [0, 1, 2],
  };
}

function circleSketch(id, extra = {}) {
  return {
    id, hostId: 'datum:xy_plane', plane: XY_PLANE, candidates: [],
    state: {
      entities: [
        { kind: 'point', id: `pc-${id}`, x: 0, y: 0 },
        { kind: 'circle', id: `c-${id}`, centerId: `pc-${id}`, radius: 5 },
      ],
      constraints: [],
    },
    ...extra,
  };
}

describe('regenerate — topological naming migration (REQ 1039)', () => {
  beforeEach(() => {
    const stub = {
      call: jest.fn().mockImplementation((method) => {
        if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
        if (method === 'buildExtrude') {
          return Promise.resolve({
            brepBytes: 'brep',
            faces: [face(TOP, LEGACY_TOP, 10, [0, 0, 1]), face(WALL, LEGACY_WALL, 5, [1, 0, 0])],
            topology: {
              vertices: [{ id: 'v:aa', legacyId: 'v3', position: [5, 0, 10] }],
              edges: [{ id: 'e:bb', legacyId: 'e7', isStraight: false, endpoints: [[5, 0, 10], [5, 0, 10]] }],
            },
          });
        }
        if (method === 'bodyVolume') return Promise.resolve({ volume: 100 });
        return Promise.resolve({ brepBytes: '', faces: [], topology: { vertices: [], edges: [] } });
      }),
    };
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns legacy → stable ids and resolves a sketch hosted on a legacy face id', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Naming' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});

    const tree = {
      features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }],
      nextFeatureSeq: 3,
    };
    const onWall = circleSketch('s2', {
      hostId: `face:${LEGACY_WALL}`,
      plane: { origin: [0, 0, 5], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] },
    });
    const doc = { sketches: { s1: circleSketch('s1'), s2: onWall }, nextSketchSeq: 3 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    const m = res.body.idMigration;
    expect(m.faces[LEGACY_WALL]).toBe(WALL);
    expect(m.faces[LEGACY_TOP]).toBeUndefined();  // already stable — nothing to migrate
    expect(m.edges).toBeUndefined();  // edge/vertex refs resolve via legacy aliases instead

    expect(res.body.danglingSketchIds).not.toContain('s2');
    expect(res.body.sketchHostFaces.s2).toBe(WALL);
  });
});
