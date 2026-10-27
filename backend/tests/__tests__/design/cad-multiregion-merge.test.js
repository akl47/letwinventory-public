// Multi-region extrude seeding × Merge result. A first-feature extrude with
// several selected regions seeds bodies; with Merge result ON the regions are
// fused and bodies follow the fuse's SOLID decomposition (touching regions —
// e.g. a boundary-with-holes plus its plug regions — merge into ONE body;
// disjoint regions stay separate). With merge OFF each region seeds its own
// body. Regression for "f1s6h5k035 extrudes as 5 separate bodies".
const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

// Two concentric circles → region 0 = inner disc, region 1 = ring-with-hole.
// These TOUCH (share the inner circle), so with merge ON the profiles merge
// into one connected boundary → a single solid cylinder (one body).
function concentricCirclesSketch(sketchId) {
  return {
    id: sketchId, hostId: 'datum:xy_plane', plane: XY_PLANE,
    state: {
      entities: [
        { kind: 'point', id: 'pc1', x: 0, y: 0 },
        { kind: 'circle', id: 'c1', centerId: 'pc1', radius: 10 },
        { kind: 'point', id: 'pc2', x: 0, y: 0 },
        { kind: 'circle', id: 'c2', centerId: 'pc2', radius: 20 },
      ],
      constraints: [],
    },
    candidates: [],
  };
}

// Two well-separated circles → two DISJOINT regions. With merge ON they build a
// prism per group and fuse; a disjoint fuse keeps two solids → two bodies.
function disjointCirclesSketch(sketchId) {
  return {
    id: sketchId, hostId: 'datum:xy_plane', plane: XY_PLANE,
    state: {
      entities: [
        { kind: 'point', id: 'pa', x: 0, y: 0 },
        { kind: 'circle', id: 'ca', centerId: 'pa', radius: 5 },
        { kind: 'point', id: 'pb', x: 100, y: 0 },
        { kind: 'circle', id: 'cb', centerId: 'pb', radius: 5 },
      ],
      constraints: [],
    },
    candidates: [],
  };
}

function fakeFaces(tag, n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    faceId: `${tag}-face-${i}`, persistentName: `${tag}-face-${i}`, isFlat: true,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
  }));
}
const fakeTopo = (tag) => ({
  vertices: [{ id: `${tag}-v0`, position: [0, 0, 0] }],
  edges: [{ id: `${tag}-e0`, isStraight: true, endpoints: [[0, 0, 0], [1, 0, 0]] }],
});

/** Kernel stub: buildExtrude per region; buildBoolean fuse returns the
 * configured solid decomposition. */
function makeStub(fuseSolidCount) {
  const stub = {
    calls: [],
    call(method, params) {
      this.calls.push({ method, params });
      if (method === 'buildBoolean' || method === 'buildFuseMany') {
        const solids = Array.from({ length: fuseSolidCount }, (_, i) => ({
          brepBytes: `solid-${i}`, centroid: [i, 0, 0], volume: 100 - i,
          faces: fakeFaces(`solid${i}`), topology: fakeTopo(`solid${i}`),
        }));
        return Promise.resolve({
          brepBytes: 'fused', faces: fakeFaces('fused', 3), topology: fakeTopo('fused'), solids,
        });
      }
      return Promise.resolve({
        brepBytes: `prism-${params.featureId}`,
        faces: fakeFaces(params.featureId), topology: fakeTopo(params.featureId),
      });
    },
  };
  stub.call = stub.call.bind(stub);
  return stub;
}

async function regenWith({ merge, fuseSolidCount, disjoint = false }) {
  const stub = makeStub(fuseSolidCount);
  jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  const auth = await authenticatedRequest();
  const part = await createTestPart();
  const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Multi-region merge' });
  const modelId = create.body.id;
  await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
  const tree = {
    features: [
      { id: 'f1', type: 'origin' },
      { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10, merge, regionIndices: [0, 1] },
    ],
    nextFeatureSeq: 3,
  };
  const doc = { sketches: { s1: (disjoint ? disjointCirclesSketch : concentricCirclesSketch)('s1') }, nextSketchSeq: 2 };
  await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });
  const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('multi-region extrude seeding × Merge result', () => {
  afterEach(() => jest.restoreAllMocks());

  it('merge ON + regions fuse into one solid → ONE body', async () => {
    const body = await regenWith({ merge: true, fuseSolidCount: 1 });
    expect(body.bodies).toHaveLength(1);
    expect(body.bodies[0].id).toBe('f2');
  });

  it('merge ON + genuinely disjoint regions (fuse yields 2 solids) → two bodies', async () => {
    const body = await regenWith({ merge: true, fuseSolidCount: 2, disjoint: true });
    expect(body.bodies.map(b => b.id).sort()).toEqual(['f2', 'f2#body1']);
  });

  it('merge OFF → one body per region (legacy seeding)', async () => {
    const body = await regenWith({ merge: false, fuseSolidCount: 1 });
    expect(body.bodies.map(b => b.id).sort()).toEqual(['f2', 'f2#body1']);
  });
});
