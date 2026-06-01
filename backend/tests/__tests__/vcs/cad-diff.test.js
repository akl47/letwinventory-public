'use strict';

// Phase 3 (REQ 699-701 / VC-31..33) — structural + 3D diff.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const cadvcs = require('../../../services/vcs/cadVcsService');
const diff = require('../../../services/vcs/cadDiffService');
const cadKernelClient = require('../../../services/cadKernelClient');

async function makeModel(uid) {
  const part = await createTestPart();
  return db.DesignCADModel.create({
    partID: part.id,
    featureTree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 },
    sketchDoc: { sketches: {}, nextSketchSeq: 1 },
    equations: { entries: {} },
    createdByUserID: uid, activeFlag: true,
  });
}

const F2 = (d) => ({ features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: d }], nextFeatureSeq: 3 });
const F2DOC = {
  sketches: { s1: { id: 's1', hostId: 'datum:xy_plane', plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }, state: { entities: [{ kind: 'point', id: 'pc', x: 0, y: 0 }, { kind: 'circle', id: 'c1', centerId: 'pc', radius: 10 }], constraints: [] } } },
  nextSketchSeq: 2,
};

describe('cadDiffService — structural', () => {
  let uid;
  beforeEach(async () => { uid = (await authenticatedRequest()).user.id; });

  test('classifies added/removed/modified/unchanged + paramDiff (VC-31, VC-32)', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = (await cadvcs.checkin(model, uid, 'init')).commitHash;
    await model.update({ featureTree: F2(10), sketchDoc: F2DOC, dirty: true });
    const c1 = (await cadvcs.checkin(model, uid, 'add f2')).commitHash;
    await model.update({ featureTree: F2(25), dirty: true });
    const c2 = (await cadvcs.checkin(model, uid, 'edit f2')).commitHash;

    const repo = await cadvcs.repoForModel(model);

    const d01 = await diff.commitDiff(repo, c0, c1);
    const s01 = Object.fromEntries(d01.entries.map(e => [e.name, e.status]));
    expect(s01['feature:f2']).toBe('added');
    expect(s01['sketch:s1']).toBe('added');

    // reverse direction → removed
    const d10 = await diff.commitDiff(repo, c1, c0);
    expect(Object.fromEntries(d10.entries.map(e => [e.name, e.status]))['feature:f2']).toBe('removed');

    const d12 = await diff.commitDiff(repo, c1, c2);
    const f2 = d12.entries.find(e => e.name === 'feature:f2');
    expect(f2.status).toBe('modified');
    expect(f2.paramDiff.changed.find(c => c.key === 'distance')).toMatchObject({ a: 10, b: 25 });

    const d00 = await diff.commitDiff(repo, c0, c0);
    expect(d00.entries.every(e => e.status === 'unchanged')).toBe(true);
  });
});

describe('cadDiffService — 3D body diff', () => {
  let uid, kernelStub;
  beforeEach(async () => {
    kernelStub = {
      calls: [],
      call: jest.fn().mockImplementation(function (method, params) {
        this.calls.push({ method, params });
        const d = params.distance || 1; // vary geometry by distance so edits show as modified
        return Promise.resolve({
          brepBytes: `BREP-${params.featureId}-${d}`,
          faces: [{ faceId: `${params.featureId}-f0`, persistentName: `${params.featureId}-f0`, isFlat: true, positions: [0, 0, 0, d, 0, 0, 0, d, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
          topology: { vertices: [{ id: 'v0', position: [0, 0, 0] }], edges: [{ id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [1, 0, 0]] }] },
        });
      }),
    };
    kernelStub.call = kernelStub.call.bind(kernelStub);
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(kernelStub);
    uid = (await authenticatedRequest()).user.id;
  });
  afterEach(() => jest.restoreAllMocks());

  test('added / unchanged / modified bodies (VC-33)', async () => {
    const model = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = (await cadvcs.checkin(model, uid, 'init')).commitHash; // origin only → no body
    await model.update({ featureTree: F2(10), sketchDoc: F2DOC, dirty: true });
    const c1 = (await cadvcs.checkin(model, uid, 'add f2')).commitHash;
    await model.update({ featureTree: F2(25), dirty: true });
    const c2 = (await cadvcs.checkin(model, uid, 'edit f2')).commitHash;

    const added = await diff.bodyDiff3D(model, c0, c1, { kernelClient: kernelStub });
    expect(added.bodies.find(b => b.id === 'f2').status).toBe('added');

    const same = await diff.bodyDiff3D(model, c1, c1, { kernelClient: kernelStub });
    expect(same.bodies.find(b => b.id === 'f2').status).toBe('unchanged');

    const mod = await diff.bodyDiff3D(model, c1, c2, { kernelClient: kernelStub });
    expect(mod.bodies.find(b => b.id === 'f2').status).toBe('modified');
  });
});
