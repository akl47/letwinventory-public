// REQ 1043 — body contacts for 3MF grouping: the backend regenerates the
// model, hands every body BRep to the kernel `bodyContacts` op, and returns
// the touching pairs plus the connected groups they form.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

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

function face(fid) {
  const id = `{"feature_id":"${fid}#0","role":"cap-top","sub_index":0,"upstream_refs":[]}`;
  return {
    faceId: id, persistentName: id, isFlat: true,
    positions: [-1, -1, 0, 1, -1, 0, 0, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
  };
}

describe('POST /cad-model/:id/body-contacts (REQ 1043)', () => {
  let stub;
  beforeEach(() => {
    stub = {
      call: jest.fn().mockImplementation((method, params) => {
        if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
        if (method === 'buildExtrude') {
          return Promise.resolve({ brepBytes: `brep-${params.featureId}`, faces: [face(params.featureId)], topology: { vertices: [], edges: [] } });
        }
        if (method === 'bodyVolume') return Promise.resolve({ volume: 100 });
        // Bodies 0 and 1 touch; body 2 stands alone.
        if (method === 'bodyContacts') return Promise.resolve({ pairs: [[0, 1]] });
        return Promise.resolve({ brepBytes: '', faces: [], topology: { vertices: [], edges: [] } });
      }),
    };
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  });
  afterEach(() => jest.restoreAllMocks());

  async function threeBodyModel(auth) {
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Contacts' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 },
        { id: 'f3', type: 'extrude', sketchId: 's2', distance: 10, merge: false },
        { id: 'f4', type: 'extrude', sketchId: 's3', distance: 10, merge: false },
      ],
      nextFeatureSeq: 5,
    };
    const doc = { sketches: { s1: circleSketch('s1', 0), s2: circleSketch('s2', 10), s3: circleSketch('s3', 50) }, nextSketchSeq: 4 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });
    return modelId;
  }

  it('returns touching pairs by body id and the connected groups', async () => {
    const auth = await authenticatedRequest();
    const modelId = await threeBodyModel(auth);

    const res = await auth.post(`/api/design/cad-model/${modelId}/body-contacts`).send({});
    expect(res.status).toBe(200);
    const ids = res.body.bodyIds;
    expect(ids).toHaveLength(3);
    expect(res.body.pairs).toEqual([[ids[0], ids[1]]]);
    expect(res.body.groups).toEqual([[ids[0], ids[1]], [ids[2]]]);

    const call = stub.call.mock.calls.find(([m]) => m === 'bodyContacts');
    expect(call[1].breps).toHaveLength(3);
  });

  it('limits the check to the requested bodies', async () => {
    const auth = await authenticatedRequest();
    const modelId = await threeBodyModel(auth);
    const all = await auth.post(`/api/design/cad-model/${modelId}/body-contacts`).send({});
    const want = all.body.bodyIds.slice(1);

    stub.call.mockClear();
    const res = await auth.post(`/api/design/cad-model/${modelId}/body-contacts`).send({ bodyIds: want });
    expect(res.status).toBe(200);
    expect(res.body.bodyIds).toEqual(want);
    const call = stub.call.mock.calls.find(([m]) => m === 'bodyContacts');
    expect(call[1].breps).toHaveLength(2);
  });

  it('404s for an unknown model', async () => {
    const auth = await authenticatedRequest();
    const res = await auth.post('/api/design/cad-model/999999/body-contacts').send({});
    expect(res.status).toBe(404);
  });
});
