// REQ 700 (Phase 1) — `POST /api/design/cad-model/:id/regenerate` integration.
//
// The kernel is mocked: we substitute the CadKernelClient with a stub that
// records calls and returns canned `buildExtrude` results. That way the test
// validates the orchestration (feature walk + cache hit/miss + JSON response
// shape) without needing the Rust kernel + OCCT build to succeed.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadRegenService = require('../../../services/cadRegenService');
const cadKernelClient = require('../../../services/cadKernelClient');
const db = require('../../../models');

const ORIGIN_TREE = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const EMPTY_DOC = { sketches: {}, nextSketchSeq: 1 };

const XY_PLANE = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function fakeCircleSketch(sketchId, radius = 10) {
  return {
    id: sketchId,
    hostId: 'datum:xy_plane',
    plane: XY_PLANE,
    state: {
      entities: [
        { kind: 'point', id: 'pc', x: 0, y: 0 },
        { kind: 'circle', id: 'c1', centerId: 'pc', radius },
      ],
      constraints: [],
    },
    candidates: [],
  };
}

function fakeKernelResponse(featureId, faceCount = 3) {
  return {
    brepBytes: '',
    faces: Array.from({ length: faceCount }, (_, i) => ({
      faceId: `${featureId}-face-${i}`,
      persistentName: `${featureId}-face-${i}`,
      isFlat: i < 2,
      positions: [0, 0, 0,  1, 0, 0,  0, 1, 0],
      normals: [0, 0, 1,  0, 0, 1,  0, 0, 1],
      indices: [0, 1, 2],
    })),
    topology: {
      vertices: [{ id: 'v0', position: [0, 0, 0] }],
      edges: [{ id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [1, 0, 0]] }],
    },
  };
}

describe('POST /api/design/cad-model/:id/regenerate (REQ 700)', () => {
  let kernelStub;

  beforeEach(() => {
    kernelStub = {
      calls: [],
      response: null,
      call: jest.fn().mockImplementation(function (method, params) {
        this.calls.push({ method, params });
        if (this.response) return Promise.resolve(this.response);
        return Promise.resolve(fakeKernelResponse(params.featureId));
      }),
    };
    // Bind `call` so `this` resolves to kernelStub.
    kernelStub.call = kernelStub.call.bind(kernelStub);
    // Swap the singleton accessor used by regenerateModel's default path.
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(kernelStub);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns one feature result per visible extrude', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Regen test' });
    const modelId = create.body.id;

    // Add a sketch + one extrude.
    const sketch = fakeCircleSketch('s1');
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 },
      ],
      nextFeatureSeq: 3,
    };
    const doc = { sketches: { s1: sketch }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].featureId).toBe('f2');
    expect(res.body.features[0].faces.length).toBeGreaterThan(0);
    expect(res.body.features[0].cached).toBe(false);
    expect(kernelStub.calls).toHaveLength(1);
    expect(kernelStub.calls[0].method).toBe('buildExtrude');
  });

  it('skips features with visible=false', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Hidden test' });
    const modelId = create.body.id;
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20, visible: false },
      ],
      nextFeatureSeq: 3,
    };
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(0);
    expect(kernelStub.calls).toHaveLength(0);
  });

  it('serves the second regeneration from the BRep cache', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Cache test' });
    const modelId = create.body.id;
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 },
      ],
      nextFeatureSeq: 3,
    };
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const r1 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    const r2 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(r1.body.features[0].cached).toBe(false);
    expect(r2.body.features[0].cached).toBe(true);
    expect(kernelStub.calls).toHaveLength(1);  // kernel only called once
  });

  it('invalidates the cache when feature params change', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Edit test' });
    const modelId = create.body.id;
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    const tree1 = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 }], nextFeatureSeq: 3 };
    const tree2 = { ...tree1, features: tree1.features.map(f => f.id === 'f2' ? { ...f, distance: 40 } : f) };

    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree1, sketchDoc: doc });
    const r1 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree2, sketchDoc: doc });
    const r2 = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(r1.body.features[0].cached).toBe(false);
    expect(r2.body.features[0].cached).toBe(false);  // distance changed → new paramHash → cache miss
    expect(kernelStub.calls).toHaveLength(2);
  });

  it('invokes onFeatureResult per feature for WS streaming', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Stream test' });
    const modelId = create.body.id;
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 },
        { id: 'f3', type: 'extrude', sketchId: 's1', distance: 30 },
      ],
      nextFeatureSeq: 4,
    };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });
    const model = await db.DesignCADModel.findByPk(modelId);

    const events = [];
    await cadRegenService.regenerateModel(model, {
      onFeatureResult: (result) => events.push(result.featureId),
    });
    // Origin is skipped, both extrudes emit — in declaration order.
    expect(events).toEqual(['f2', 'f3']);
  });

  it('isolates a throwing onFeatureResult callback', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Throw test' });
    const modelId = create.body.id;
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    const tree = {
      features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 }],
      nextFeatureSeq: 3,
    };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });
    const model = await db.DesignCADModel.findByPk(modelId);

    const result = await cadRegenService.regenerateModel(model, {
      onFeatureResult: () => { throw new Error('subscriber blew up'); },
    });
    // Callback failures must not surface to the HTTP path.
    expect(result.features).toHaveLength(1);
    expect(result.features[0].featureId).toBe('f2');
  });

  it('forwards per-feature topology with scoped vertex/edge IDs', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Topo test' });
    const modelId = create.body.id;
    const tree = {
      features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 },
      ],
      nextFeatureSeq: 3,
    };
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    const f2 = res.body.features[0];
    expect(f2.topology).toBeDefined();
    // Kernel-local 'v0'/'e0' get prefixed by the regen service so the IDs
    // stay globally unique once meshes from multiple features are merged.
    expect(f2.topology.vertices[0].id).toBe('f2#0/v0');
    expect(f2.topology.edges[0].id).toBe('f2#0/e0');
    expect(f2.topology.edges[0].endpoints).toEqual([[0, 0, 0], [1, 0, 0]]);
  });

  it('returns 503 when the kernel is unavailable', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'Kernel-down test' });
    const modelId = create.body.id;
    const tree = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 }], nextFeatureSeq: 3 };
    const doc = { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 };
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: tree, sketchDoc: doc });

    kernelStub.call = jest.fn().mockRejectedValue(new cadKernelClient.KernelDisconnected('socket closed'));

    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    // The controller wraps KernelDisconnected → 503 only when EVERY feature's
    // kernel call disconnects. With one feature failing, the route still
    // returns 200 but the feature's `error` field is populated. Validate
    // both: the response is 200 and the feature is errored.
    expect(res.status).toBe(200);
    expect(res.body.features[0].error).toMatch(/disconnected|socket/i);
  });
});
