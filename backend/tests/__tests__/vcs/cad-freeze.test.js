'use strict';

// REQ 684-685 (VC-16, VC-17) — geometry freeze. The kernel is stubbed (as in
// cad-regenerate.test.js) so we validate the freeze/thaw orchestration without
// the Rust kernel.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');
const cadvcs = require('../../../services/vcs/cadVcsService');
const freeze = require('../../../services/vcs/cadFreezeService');
const cadKernelClient = require('../../../services/cadKernelClient');

function fakeCircleSketch(id) {
  return {
    id, hostId: 'datum:xy_plane',
    plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    state: { entities: [{ kind: 'point', id: 'pc', x: 0, y: 0 }, { kind: 'circle', id: 'c1', centerId: 'pc', radius: 10 }], constraints: [] },
    candidates: [],
  };
}

function fakeKernelResponse(featureId) {
  return {
    brepBytes: `BREP-${featureId}`,
    faces: [{ faceId: `${featureId}-f0`, persistentName: `${featureId}-f0`, isFlat: true, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
    topology: { vertices: [{ id: 'v0', position: [0, 0, 0] }], edges: [{ id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [1, 0, 0]] }] },
  };
}

async function makeExtrudeModel(uid) {
  const part = await createTestPart();
  return db.DesignCADModel.create({
    partID: part.id, revision: 'A',
    featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 20 }], nextFeatureSeq: 3 },
    sketchDoc: { sketches: { s1: fakeCircleSketch('s1') }, nextSketchSeq: 2 },
    equations: { entries: {} },
    releaseState: 'draft', createdByUserID: uid, activeFlag: true,
  });
}

describe('cadFreezeService', () => {
  let kernelStub, uid;
  beforeEach(async () => {
    kernelStub = {
      calls: [],
      call: jest.fn().mockImplementation(function (method, params) {
        this.calls.push({ method, params });
        return Promise.resolve(fakeKernelResponse(params.featureId));
      }),
    };
    kernelStub.call = kernelStub.call.bind(kernelStub);
    jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(kernelStub);
    uid = (await authenticatedRequest()).user.id;
  });
  afterEach(() => jest.restoreAllMocks());

  test('freeze stores per-body BReps + a mesh snapshot', async () => {
    const model = await makeExtrudeModel(uid);
    const repo = await cadvcs.repoForModel(model);
    const frozen = await freeze.freezeGeometry(repo, model, { kernelClient: kernelStub });
    expect(frozen.meshHash).toBeTruthy();
    expect(frozen.bodies.length).toBeGreaterThan(0);
    expect(frozen.bodies.some(b => b.brepHash)).toBe(true);
  });

  test('frozen geometry loads with zero additional kernel calls (VC-17)', async () => {
    const model = await makeExtrudeModel(uid);
    const repo = await cadvcs.repoForModel(model);
    const frozen = await freeze.freezeGeometry(repo, model, { kernelClient: kernelStub });
    const callsAfterFreeze = kernelStub.calls.length;

    const loaded = await freeze.loadFrozenGeometry(repo, frozen);
    expect(loaded.frozen).toBe(true);
    expect(loaded.features.length).toBeGreaterThan(0);
    expect(loaded.bodies.some(b => b.brep)).toBe(true);
    expect(kernelStub.calls.length).toBe(callsAfterFreeze); // no kernel during thaw
  });

  test('checkout of a frozen commit skips the kernel; a non-frozen commit regenerates', async () => {
    const model = await makeExtrudeModel(uid);
    const repo = await cadvcs.repoForModel(model);

    // Frozen release commit: freeze + reference the frozen meta on the commit.
    const frozen = await freeze.freezeGeometry(repo, model, { kernelClient: kernelStub });
    const treeHash = await require('../../../services/vcs/cadSerializer').cadSerialize(repo, {
      featureTree: model.featureTree, sketchDoc: model.sketchDoc, equations: model.equations,
    });
    const releasedCommit = await vcs.createCommit(repo, {
      treeHash, parents: [], authorUserID: uid, message: 'release', timestamp: '2026-06-01T00:00:00.000Z',
      meta: { ...cadvcs.cadVersionInfo(), frozen },
    });
    const draftCommit = await vcs.createCommit(repo, {
      treeHash, parents: [releasedCommit], authorUserID: uid, message: 'draft', timestamp: '2026-06-01T00:01:00.000Z',
      meta: cadvcs.cadVersionInfo(),
    });

    const callsBeforeFrozen = kernelStub.calls.length;
    const frozenGeo = await freeze.geometryForCommit(repo, model, releasedCommit, { kernelClient: kernelStub });
    expect(frozenGeo.frozen).toBe(true);
    expect(kernelStub.calls.length).toBe(callsBeforeFrozen); // frozen → no kernel

    // Draft path regenerates from the recipe. Clear the BRep cache (warm from
    // the freeze) so the regeneration must actually hit the kernel.
    await db.DesignBRepCache.destroy({ where: {}, force: true });
    const callsBeforeDraft = kernelStub.calls.length;
    const liveGeo = await freeze.geometryForCommit(repo, model, draftCommit, { kernelClient: kernelStub });
    expect(liveGeo.frozen).not.toBe(true);              // took the regen path
    expect(liveGeo.features.length).toBeGreaterThan(0);
    expect(kernelStub.calls.length).toBeGreaterThan(callsBeforeDraft); // cold cache → kernel ran
  });
});
