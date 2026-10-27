// Perf regression: the multi-region prism fuse must be CACHED. Previously the
// N-1 progressive buildBoolean fuse calls re-ran on every regen even when every
// region prism was cached, so a repeat regen of a multi-glyph text cut still
// cost ~1s per glyph. Caching the fused prism under the feature-level param hash
// makes a warm regen skip the kernel entirely. (part 573 / model 5 in dev.)
const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

// Two well-separated circles → two DISJOINT regions → one fuse call.
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

const fakeFaces = (tag, n = 2) => Array.from({ length: n }, (_, i) => ({
  faceId: `${tag}-face-${i}`, persistentName: `${tag}-face-${i}`, isFlat: true,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
}));
const fakeTopo = (tag) => ({
  vertices: [{ id: `${tag}-v0`, position: [0, 0, 0] }],
  edges: [{ id: `${tag}-e0`, isStraight: true, endpoints: [[0, 0, 0], [1, 0, 0]] }],
});

function makeStub() {
  const stub = {
    calls: [],
    call(method, params) {
      this.calls.push({ method, params });
      if (method === 'buildBoolean' || method === 'buildFuseMany') {
        const solids = [0, 1].map((i) => ({
          brepBytes: `solid-${i}`, centroid: [i, 0, 0], volume: 100 - i,
          faces: fakeFaces(`solid${i}`), topology: fakeTopo(`solid${i}`),
        }));
        return Promise.resolve({ brepBytes: 'fused', faces: fakeFaces('fused', 3), topology: fakeTopo('fused'), solids });
      }
      return Promise.resolve({ brepBytes: `prism-${params.featureId}`, faces: fakeFaces(params.featureId), topology: fakeTopo(params.featureId) });
    },
  };
  stub.call = stub.call.bind(stub);
  return stub;
}

describe('multi-region fuse is cached across regens (REQ perf)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-fuses on the first regen but serves the fused prism from cache on the second', async () => {
    const stub = makeStub();
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Fuse cache' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10, merge: true, regionIndices: [0, 1] },
      ],
      nextFeatureSeq: 3,
    };
    const doc = { sketches: { s1: disjointCirclesSketch('s1') }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    // First regen: cold — the fuse runs (one buildFuseMany, or pairwise
    // buildBoolean on a pre-cpp-11 kernel; the stub answers both).
    const r1 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(r1.status).toBe(200);
    expect(stub.calls.filter((c) => c.method === 'buildBoolean' || c.method === 'buildFuseMany').length).toBeGreaterThan(0);
    const bodies1 = r1.body.bodies.map((b) => b.id).sort();
    expect(bodies1).toEqual(['f2', 'f2#body1']); // disjoint fuse → 2 solids → 2 bodies

    // Second regen: warm — the region prisms AND the fuse are cached, so the
    // kernel is not touched at all, and the fused-solid decomposition (hence
    // the body split) is reproduced from cache.
    stub.calls.length = 0;
    const r2 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(r2.status).toBe(200);
    expect(stub.calls.filter((c) => c.method === 'buildBoolean' || c.method === 'buildFuseMany').length).toBe(0);
    expect(stub.calls.filter((c) => c.method === 'buildExtrude').length).toBe(0);
    expect(r2.body.bodies.map((b) => b.id).sort()).toEqual(bodies1);
  });
});
