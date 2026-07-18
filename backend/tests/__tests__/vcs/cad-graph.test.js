'use strict';

// Version graph for the CAD history UI (D1/D4).

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const cadvcs = require('../../../services/vcs/cadVcsService');
const branchSvc = require('../../../services/vcs/cadBranchService');
const { buildGraph, initialsOf } = require('../../../services/vcs/cadGraphService');

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

describe('cadGraphService.buildGraph', () => {
  let uid;
  beforeEach(async () => { uid = (await authenticatedRequest()).user.id; });

  test('builds nodes across branches with lanes, head, and author', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = (await cadvcs.checkin(model, uid, 'init')).commitHash;
    await model.update({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 }, dirty: true });
    const c1 = (await cadvcs.checkin(model, uid, 'add f2')).commitHash;

    await branchSvc.createBranch(model, 'experiment/x', { fromCommit: c0 }, uid);
    await branchSvc.switchBranch(model, 'experiment/x', uid);
    await model.update({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f3', type: 'extrude', sketchId: 's2', distance: 5 }], nextFeatureSeq: 3 }, dirty: true });
    const c2 = (await cadvcs.checkin(model, uid, 'exp work')).commitHash;

    const g = await buildGraph(model);
    expect(g.nodes.map(n => n.hash).sort()).toEqual([c0, c1, c2].sort());
    const byHash = Object.fromEntries(g.nodes.map(n => [n.hash, n]));
    expect(byHash[c0].lane).toBe('main');
    expect(byHash[c1].lane).toBe('main');
    expect(byHash[c2].lane).toBe('exp');
    expect(byHash[c2].branch).toBe('experiment/x');
    expect(byHash[c2].isHead).toBe(true); // current branch head
    expect(byHash[c0].author.name).toBeTruthy();
    expect(g.branches.map(b => b.name).sort()).toEqual(['experiment/x', 'main']);
  });

  test('release tags appear on the tagged node', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    await cadvcs.checkin(model, uid, 'init');
    const { commitHash, tag } = await cadvcs.release(model, uid, 'B', {}); // origin-only → no kernel

    const g = await buildGraph(model);
    const node = g.nodes.find(n => n.hash === commitHash);
    expect(node.tags).toContain(tag);
    expect(node.state).toBe('released');
  });

  test('initialsOf', () => {
    expect(initialsOf('Maya Chen')).toBe('MC');
    expect(initialsOf('Jon')).toBe('J');
  });
});
