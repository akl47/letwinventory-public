'use strict';

// Phase 2 (REQ 692-697 / VC-24..29) — variant branches + cherry-pick, no merge.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const cadvcs = require('../../../services/vcs/cadVcsService');
const branchSvc = require('../../../services/vcs/cadBranchService');

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

const F2_TREE = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 };
const F2_DOC = { sketches: { s1: { id: 's1', state: { entities: [], constraints: [] } } }, nextSketchSeq: 2 };

describe('cadBranchService', () => {
  let uid;
  beforeEach(async () => { uid = (await authenticatedRequest()).user.id; });

  test('create + list branches (VC-24, VC-25)', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = await cadvcs.checkin(model, uid, 'init');
    const b = await branchSvc.createBranch(model, 'variant', {}, uid);
    expect(b.targetHash).toBe(c0.commitHash); // defaults to current head
    const list = await branchSvc.listBranches(model);
    expect(list.map(r => r.name).sort()).toEqual(['main', 'variant']);
  });

  test('switch loads the branch state; rejects while dirty (VC-26)', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = await cadvcs.checkin(model, uid, 'init'); // main @ origin-only
    await branchSvc.createBranch(model, 'variant', { fromCommit: c0.commitHash }, uid);

    // Make an uncommitted edit → switching must be rejected.
    await model.update({ featureTree: F2_TREE, sketchDoc: F2_DOC, dirty: true });
    await expect(branchSvc.switchBranch(model, 'variant', uid)).rejects.toMatchObject({ statusCode: 409 });

    // Commit, then switch back to the (origin-only) variant.
    await cadvcs.checkin(model, uid, 'add f2');
    await branchSvc.switchBranch(model, 'variant', uid);
    expect(model.branchName).toBe('variant');
    expect(model.featureTree.features.map(f => f.id)).toEqual(['f1']);
  });

  test('archive removes a branch; current + default protected (VC-27)', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    await cadvcs.checkin(model, uid, 'init');
    await branchSvc.createBranch(model, 'variant', {}, uid);

    await expect(branchSvc.archiveBranch(model, 'main')).rejects.toMatchObject({ statusCode: 409 });
    await branchSvc.archiveBranch(model, 'variant');
    expect((await branchSvc.listBranches(model)).map(r => r.name)).toEqual(['main']);

    await branchSvc.createBranch(model, 'v2', {}, uid);
    await branchSvc.switchBranch(model, 'v2', uid);
    await expect(branchSvc.archiveBranch(model, 'v2')).rejects.toMatchObject({ statusCode: 409 });
  });

  test('cherry-pick splices a feature + its sketches into the working copy (VC-28)', async () => {
    const { model } = await cadvcs.checkout(await makeModel(uid), uid, {});
    const c0 = await cadvcs.checkin(model, uid, 'init'); // origin only
    await model.update({ featureTree: F2_TREE, sketchDoc: F2_DOC, dirty: true });
    const c1 = await cadvcs.checkin(model, uid, 'add f2'); // main has f2 + s1

    await branchSvc.createBranch(model, 'variant', { fromCommit: c0.commitHash }, uid);
    await branchSvc.switchBranch(model, 'variant', uid);
    expect(model.featureTree.features.map(f => f.id)).toEqual(['f1']);

    await branchSvc.cherryPick(model, c1.commitHash, 'f2', uid);
    expect(model.featureTree.features.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(model.sketchDoc.sketches.s1).toBeDefined();
    expect(model.dirty).toBe(true);
  });

  test('no automatic merge operation exists (VC-29)', () => {
    expect(branchSvc.merge).toBeUndefined();
    expect(cadvcs.merge).toBeUndefined();
  });
});
