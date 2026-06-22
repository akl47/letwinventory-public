// REQ 841 — Geometry pattern (SolidWorks/OnShape parity).
//
// Orchestration test (kernel mocked): a feature-mode circular pattern with
// `geometryPattern: true` must pattern the seed GROUP's finished geometry via a
// single `buildFeaturePattern` call (featureId `<id>#gpattern`), NOT re-run each
// seed's boolean per instance (`buildToolPattern`). With the flag off, the
// existing per-seed feature-pattern path is used. Geometry correctness of the
// resulting BREP is covered separately by the kernel; here we assert the
// dispatch decision, which is where the duplicate-face bug originated.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadKernelClient = require('../../../services/cadKernelClient');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const YZ_PLANE = { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] };

const circleSketch = (id, radius = 8) => ({
  id, hostId: 'datum:xy_plane', plane: XY_PLANE,
  state: {
    entities: [
      { kind: 'point', id: `${id}-c`, x: 0, y: 0 },
      { kind: 'circle', id: `${id}-circ`, centerId: `${id}-c`, radius },
    ],
    constraints: [],
  },
  candidates: [],
});

// A response whose brep + faces are unique per call so the regen's body brep
// changes after every feature — required for the per-seed before/after
// snapshots the geometry-pattern path reads.
function uniqueResponse(featureId) {
  return {
    brepBytes: Buffer.from(`brep-${featureId}-${Math.random()}`).toString('base64'),
    faces: [{
      faceId: `${featureId}-f0`, persistentName: `${featureId}-f0`, isFlat: true,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
    }],
    topology: { vertices: [{ id: `${featureId}-v0`, position: [0, 0, 0] }], edges: [] },
    solids: [{
      brepBytes: Buffer.from(`solid-${featureId}`).toString('base64'),
      centroid: [0, 0, 0], volume: 100,
      faces: [{ faceId: `${featureId}-f0`, persistentName: `${featureId}-f0`, isFlat: true, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
      topology: { vertices: [], edges: [] },
    }],
  };
}

describe('Geometry pattern dispatch (REQ 841)', () => {
  let kernelStub;
  beforeEach(() => {
    kernelStub = {
      calls: [],
      call: jest.fn().mockImplementation(function (method, params) {
        if (method === 'ping') return Promise.resolve({ ok: true, build: 'test' });
        this.calls.push({ method, params });
        return Promise.resolve(uniqueResponse((params && params.featureId) || method));
      }),
    };
    kernelStub.call = kernelStub.call.bind(kernelStub);
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(kernelStub);
  });
  afterEach(() => jest.restoreAllMocks());

  // boss (extrude) + slot (cut) + circular pattern of BOTH about Z.
  // `gp`: true / false / undefined (omitted) — undefined exercises the default.
  const buildTree = (gp) => ({
    features: [
      { id: 'f1', type: 'origin' },
      { id: 'fboss', type: 'extrude', sketchId: 'sboss', distance: 20, endCondition: { kind: 'midPlane' } },
      { id: 'fslot', type: 'cutExtrude', sketchId: 'sslot', distance: 10, endCondition: { kind: 'midPlane' } },
      {
        id: 'fpat', type: 'circularPattern',
        axisRef: { kind: 'originAxis', axisId: 'z_axis' },
        axisSnapshot: { origin: [0, 0, 0], direction: [0, 0, 1] },
        count: 3, mode: 'equalSpacing', angleDeg: 360,
        seedKind: 'features', seedFeatureIds: ['fboss', 'fslot'],
        ...(gp === undefined ? {} : { geometryPattern: gp }),
      },
    ],
    nextFeatureSeq: 5,
  });
  const doc = { sketches: { sboss: circleSketch('sboss', 8), sslot: { ...circleSketch('sslot', 4), plane: YZ_PLANE } }, nextSketchSeq: 3 };

  async function regen(geometryPattern) {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const create = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'GP test' });
    const modelId = create.body.id;
    await auth.post(`/api/design/cad-model/${modelId}/checkout`).send({});
    await auth.put(`/api/design/cad-model/${modelId}`).send({ featureTree: buildTree(geometryPattern), sketchDoc: doc });
    const res = await auth.post(`/api/design/cad-model/${modelId}/regenerate`);
    expect(res.status).toBe(200);
    return res;
  }

  const gpCallCount = () => kernelStub.calls.filter(c => c.method === 'buildFeaturePattern' && /#gpattern$/.test(c.params.featureId)).length;
  const toolCallCount = () => kernelStub.calls.filter(c => c.method === 'buildToolPattern').length;

  it('geometryPattern:true → ONE buildFeaturePattern over the seed group, no buildToolPattern', async () => {
    await regen(true);
    expect(gpCallCount()).toBe(1);
    expect(toolCallCount()).toBe(0);
    const gp = kernelStub.calls.find(c => /#gpattern$/.test(c.params.featureId));
    expect(gp.params.afterBrep).toBeTruthy();
    expect(Array.isArray(gp.params.transforms)).toBe(true);
  });

  it('geometryPattern absent → defaults ON (geometry pattern)', async () => {
    await regen(undefined);
    expect(gpCallCount()).toBe(1);
    expect(toolCallCount()).toBe(0);
  });

  it('geometryPattern:false → explicit opt-out uses per-seed feature pattern', async () => {
    await regen(false);
    expect(gpCallCount()).toBe(0);
    expect(toolCallCount()).toBeGreaterThan(0);
  });
});
