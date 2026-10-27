'use strict';

// REQ 774 — checking in a part that carries a cross-part in-context reference pins
// the SOURCE part's current commit, writes a content-addressed `component` object,
// and records a `VcsUsage` edge, so a historical revision reproduces exactly and
// "which parts reference B?" is answerable.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const cadVcs = require('../../../services/vcs/cadVcsService');
const vcs = require('../../../services/vcs/vcsService');

const createModel = async (auth, partId) =>
  (await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' })).body;

const crossPartSketchDoc = (sourcePartId) => ({
  sketches: {
    s1: {
      id: 's1', hostId: 'datum:xy_plane',
      plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      state: {
        entities: [
          { kind: 'point', id: 'p1', x: 0, y: 0 },
          { kind: 'point', id: 'p2', x: 1, y: 0 },
          { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        ],
        constraints: [{
          id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l1' }],
          externalRef: {
            scope: 'cross-part', definingAssemblyId: 1, definingAssemblyRepoId: '1',
            sourceInstanceId: 'i2', sourcePartId,
            sourceGeomRef: { featureId: 'f1', edgeId: 'f1/e0' },
            cachedProjection: { edges: [{ polyline: [[0, 0, 0], [1, 0, 0]] }] },
          },
        }],
      },
      candidates: [],
    },
  },
  nextSketchSeq: 2,
});

describe('cross-part in-context check-in pinning (REQ 774)', () => {
  test('pins the source commit and writes component + VcsUsage records', async () => {
    const auth = await authenticatedRequest();
    const db = global.db;

    // Source part B (its create seeds main + draft/01, so it has a head commit).
    const partB = await createTestPart();
    const modelB = await createModel(auth, partB.id);
    const bRowBefore = await db.DesignCADModel.findByPk(modelB.id);
    const repoB = await cadVcs.repoForModel(bRowBefore, db);
    const bHead = await vcs.getRef(repoB, bRowBefore.branchName || 'main', db);
    expect(bHead && bHead.targetHash).toBeTruthy();

    // Dependent part A references B's geometry.
    const partA = await createTestPart();
    const modelA = await createModel(auth, partA.id);
    await auth.post(`/api/design/cad-model/${modelA.id}/checkout`).send({});
    await auth.put(`/api/design/cad-model/${modelA.id}`).send({ sketchDoc: crossPartSketchDoc(partB.id) });
    const ci = await auth.post(`/api/design/cad-model/${modelA.id}/checkin`).send({ message: 'add cross-part ref' });
    expect(ci.status).toBe(200);

    // 1. the ref is pinned to B's head commit
    const aRow = await db.DesignCADModel.findByPk(modelA.id);
    const er = aRow.sketchDoc.sketches.s1.state.constraints[0].externalRef;
    expect(er.pinnedSourceCommit).toBe(bHead.targetHash);

    // 2. a content-addressed `component` object exists in A's repo
    const repoA = await cadVcs.repoForModel(aRow, db);
    const comp = await db.VcsObject.findOne({
      where: { repoType: repoA.repoType, repoId: String(repoA.repoId), kind: 'component' },
    });
    expect(comp).toBeTruthy();
    expect(comp.content).toMatchObject({
      childRepoType: 'cad', childRepoId: String(repoB.repoId), instanceId: 'i2',
      ref: { commitHash: bHead.targetHash },
    });

    // 3. a VcsUsage edge records A → B (impact analysis)
    const usage = await db.VcsUsage.findOne({
      where: { childRepoType: 'cad', childRepoId: String(repoB.repoId), parentRepoId: String(repoA.repoId) },
    });
    expect(usage).toBeTruthy();
    expect(usage.parentCommitHash).toBe(ci.body.commitHash);
  });
});
