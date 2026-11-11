// REQ 1052 — a sketch hosted on a face follows that face for every consumer:
// a hole on one of its points drills where the face is now, and regen reports
// the moved plane for the editor to adopt.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const TOP = '{"feature_id":"f2#0","role":"cap-top","sub_index":0,"upstream_refs":[]}';

describe('face-hosted sketch follows its face (REQ 1052)', () => {
  let stub;
  beforeEach(() => {
    stub = {
      call: jest.fn().mockImplementation((method, params) => {
        if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
        if (method === 'buildExtrude' && params.featureId === 'f2#0') {
          const z = params.distance;  // the top face sits at the extrude height
          return Promise.resolve({
            brepBytes: 'brep-f2',
            faces: [{ faceId: TOP, persistentName: TOP, isFlat: true, positions: [-1, -1, z, 1, -1, z, 0, 2, z], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
            topology: { vertices: [], edges: [] },
          });
        }
        if (method === 'bodyVolume') return Promise.resolve({ volume: 100 });
        return Promise.resolve({ brepBytes: `out-${params.featureId}`, faces: [], topology: { vertices: [], edges: [] } });
      }),
    };
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  });
  afterEach(() => jest.restoreAllMocks());

  it('drills a hole on a hosted sketch point at the moved face and reports the new plane', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Follow' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
    // The hole sketch was drawn on the top face when the extrude was 10 tall;
    // the extrude is now 6 tall.
    const doc = {
      sketches: {
        s1: {
          id: 's1', hostId: 'datum:xy_plane', plane: XY_PLANE, candidates: [],
          state: { entities: [{ kind: 'point', id: 'pc', x: 0, y: 0 }, { kind: 'circle', id: 'c', centerId: 'pc', radius: 20 }], constraints: [] },
        },
        s2: {
          id: 's2', hostId: `face:${TOP}`, plane: { ...XY_PLANE, origin: [0, 0, 10] }, candidates: [],
          state: { entities: [{ kind: 'point', id: 'p1', x: 3, y: 4 }], constraints: [] },
        },
      },
      nextSketchSeq: 3,
    };
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 6 },
        {
          id: 'f3', type: 'hole', holeType: 'drill', standard: 'iso', size: 'M3', endCondition: { kind: 'throughAll' },
          placements: [{ faceId: 'vertex:sketch:s2/p1', position: [3, 4, 10], faceCentroid: [3, 4, 10], faceNormal: [0, 0, 1] }],
        },
      ],
      nextFeatureSeq: 4,
    };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    const drill = stub.call.mock.calls.find(([m, p]) => m === 'buildExtrude' && String(p.featureId).startsWith('f3#p0'));
    expect(drill[1].plane.origin.map(v => Math.round(v * 1e6) / 1e6)).toEqual([3, 4, 6]);
    expect(res.body.sketchPlanes).toEqual({ s2: { ...XY_PLANE, origin: [0, 0, 6] } });
  });
});
