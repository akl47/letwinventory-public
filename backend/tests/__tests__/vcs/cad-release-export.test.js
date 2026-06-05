'use strict';

// Released-revision file export (REQ 719): STEP + STL are served from the
// FROZEN release geometry (loaded from stored BReps), so the kernel is invoked
// only for serialization — never a live regeneration.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const F2 = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 };
const F2DOC = {
  sketches: { s1: { id: 's1', hostId: 'datum:xy_plane', plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, state: { entities: [{ kind: 'point', id: 'pc', x: 0, y: 0 }, { kind: 'circle', id: 'c1', centerId: 'pc', radius: 10 }], constraints: [] } } },
  nextSketchSeq: 2,
};

const url = (id, p) => `/api/design/cad-model/${id}${p}`;

function readBytes(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(Buffer.from(c)));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('CAD release export (frozen)', () => {
  let stub;
  beforeEach(() => {
    stub = {
      call: jest.fn().mockImplementation((method, params) => {
        if (method === 'exportStep') return Promise.resolve({ step: `STEP[${(params.breps || []).length}]` });
        if (method === 'exportStl') return Promise.resolve({ stlBase64: Buffer.from('solid-bytes').toString('base64') });
        return Promise.resolve({
          brepBytes: `BREP-${params.featureId}`,
          faces: [{ faceId: `${params.featureId}-f0`, persistentName: `${params.featureId}-f0`, isFlat: true, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
          topology: { vertices: [], edges: [] },
        });
      }),
    };
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  });
  afterEach(() => jest.restoreAllMocks());

  async function releasedModel(auth) {
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await auth.post(url(model.id, '/checkout')).send({});
    await auth.put(url(model.id, '')).send({ featureTree: F2, sketchDoc: F2DOC });
    await auth.post(url(model.id, '/checkin')).send({ message: 'add f2' });
    expect((await auth.post(url(model.id, '/dev-release')).send({})).status).toBe(200);
    return model;
  }

  test('exports STEP from the frozen release', async () => {
    const auth = await authenticatedRequest();
    const model = await releasedModel(auth);
    const r = await auth.get(url(model.id, '/release/step'));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/step/);
    expect(r.headers['content-disposition']).toMatch(/\.step"/);
    expect(r.text).toMatch(/^STEP\[\d+\]/);
    // exportStep was fed the frozen body BReps.
    const call = stub.call.mock.calls.find((c) => c[0] === 'exportStep');
    expect(call[1].breps.length).toBeGreaterThan(0);
  });

  test('exports STL bytes from the frozen release', async () => {
    const auth = await authenticatedRequest();
    const model = await releasedModel(auth);
    const r = await readBytes(auth.get(url(model.id, '/release/stl')));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/model\/stl/);
    expect(Buffer.from(r.body).toString()).toBe('solid-bytes');
  });

  test('409 when the revision has not been released', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    expect((await auth.get(url(model.id, '/release/step'))).status).toBe(409);
  });
});
