// The shell hollows the body that owns its picked face — not whichever body
// was created last (a later "new body" extrude used to steal the target and
// fail with "picked face has no match").

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const topOf = (fid) => `{"feature_id":"${fid}#0","role":"cap-top","sub_index":0,"upstream_refs":[]}`;

function circleSketch(id, cx) {
  return {
    id, hostId: 'datum:xy_plane', plane: XY_PLANE, candidates: [],
    state: {
      entities: [
        { kind: 'point', id: `pc-${id}`, x: cx, y: 0 },
        { kind: 'circle', id: `c-${id}`, centerId: `pc-${id}`, radius: 5 },
      ],
      constraints: [],
    },
  };
}

describe('shell target body', () => {
  let stub;
  beforeEach(() => {
    stub = {
      call: jest.fn().mockImplementation((method, params) => {
        if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
        if (method === 'buildExtrude') {
          const id = topOf(String(params.featureId).split('#')[0]);
          return Promise.resolve({
            brepBytes: `brep-${params.featureId}`,
            faces: [{ faceId: id, persistentName: id, isFlat: true, positions: [-1, -1, 10, 1, -1, 10, 0, 2, 10], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
            topology: { vertices: [], edges: [] },
          });
        }
        if (method === 'bodyVolume') return Promise.resolve({ volume: 100 });
        return Promise.resolve({ brepBytes: `shelled-${params.aBrep}`, faces: [], topology: { vertices: [], edges: [] } });
      }),
    };
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  });
  afterEach(() => jest.restoreAllMocks());

  it('hollows the body owning the picked face even when a newer body exists', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Shell' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 },
        { id: 'f3', type: 'extrude', sketchId: 's2', distance: 10, merge: false },
        {
          id: 'f4', type: 'shell', thickness: 1, direction: 'inward',
          faces: [{ faceId: topOf('f2'), fallbackPlane: { origin: [0, 0, 10], normal: [0, 0, 1] } }],
        },
      ],
      nextFeatureSeq: 5,
    };
    const doc = { sketches: { s1: circleSketch('s1', 0), s2: circleSketch('s2', 50) }, nextSketchSeq: 3 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    const shell = stub.call.mock.calls.find(([m]) => m === 'buildShell');
    expect(shell[1].aBrep).toBe('brep-f2#0');  // f2's body (the newer one is brep-f3#0)
  });
});
