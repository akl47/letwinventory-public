// REQ 911/913/914 — assembly SKELETON content: the PUT /:id/skeleton endpoint
// (guards mirroring part-CAD content saves) and the VCS round-trip of the
// bundle {assemblyDoc, sketchDoc, featureTree, equations}.

const { authenticatedRequest, createTestPart, createTestUser } = require('../../helpers');
const db = require('../../../models');
const { assemblySerialize, assemblyDeserialize } = require('../../../services/vcs/assemblySerializer');

const SKELETON_SKETCH_DOC = {
  nextSketchSeq: 2,
  sketches: {
    s1: {
      id: 's1', name: 'Skeleton 1', hostId: 'datum:xy_plane',
      plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      state: {
        entities: [
          { kind: 'point', id: 'origin', x: 0, y: 0 },
          { kind: 'point', id: 'pa', x: 0, y: 0 },
          { kind: 'point', id: 'pb', x: 50, y: 0 },
          { kind: 'line', id: 'l1', startId: 'pa', endId: 'pb' },
        ],
        constraints: [],
      },
      candidates: [],
      createdAt: 1700000000000,
    },
  },
};
const SKELETON_FEATURE_TREE = {
  nextFeatureSeq: 2,
  features: [
    { id: 'dp1', type: 'datumPlane', name: 'Plane 1', method: { kind: 'offset', planeRef: { kind: 'datum', datumId: 'xy_plane' }, distance: 10 } },
  ],
};
const SKELETON_EQUATIONS = { entries: { width: { expression: '50' } } };

/** Create an assembly on a draft branch with the checkout held. */
async function editableAssembly(auth) {
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
  const id = asm.body.id;
  await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
  await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });
  await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
  return id;
}

describe('PUT /api/design/assembly/:id/skeleton (REQ 911/914)', () => {
  it('saves sketchDoc + featureTree + equations and marks the copy dirty', async () => {
    const auth = await authenticatedRequest();
    const id = await editableAssembly(auth);
    const res = await auth.put(`/api/design/assembly/${id}/skeleton`).send({
      sketchDoc: SKELETON_SKETCH_DOC,
      featureTree: SKELETON_FEATURE_TREE,
      equations: SKELETON_EQUATIONS,
    });
    expect(res.status).toBe(200);
    expect(res.body.dirty).toBe(true);
    expect(res.body.lastContentSavedAt).toBeTruthy();
    const row = await db.DesignCADModel.findByPk(id);
    expect(row.sketchDoc.sketches.s1.name).toBe('Skeleton 1');
    expect(row.featureTree.features[0].id).toBe('dp1');
    expect(row.equations.entries.width.expression).toBe('50');
  });

  it('rejects a skeleton save on main with 423', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const res = await auth.put(`/api/design/assembly/${asm.body.id}/skeleton`)
      .send({ sketchDoc: SKELETON_SKETCH_DOC });
    expect(res.status).toBe(423);
  });

  it('rejects a save without the checkout lock with 423', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const id = asm.body.id;
    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });
    // No checkout.
    const res = await auth.put(`/api/design/assembly/${id}/skeleton`).send({ sketchDoc: SKELETON_SKETCH_DOC });
    expect(res.status).toBe(423);
  });

  it('rejects a save from a session holding another user\'s lock target with 423', async () => {
    const auth = await authenticatedRequest();
    const other = await authenticatedRequest(await createTestUser({ displayName: 'Second Skeleton User' }));
    const id = await editableAssembly(auth);
    const res = await other.put(`/api/design/assembly/${id}/skeleton`).send({ sketchDoc: SKELETON_SKETCH_DOC });
    expect(res.status).toBe(423);
  });

  it('rejects a stale clientSavedAt with 409 DOC_CONFLICT', async () => {
    const auth = await authenticatedRequest();
    const id = await editableAssembly(auth);
    // First save moves lastContentSavedAt.
    const first = await auth.put(`/api/design/assembly/${id}/skeleton`)
      .send({ sketchDoc: SKELETON_SKETCH_DOC, clientSavedAt: null });
    expect(first.status).toBe(200);
    // Second save echoing the PRE-first token (null) is stale.
    const second = await auth.put(`/api/design/assembly/${id}/skeleton`)
      .send({ equations: SKELETON_EQUATIONS, clientSavedAt: null });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DOC_CONFLICT');
    // Echoing the current token succeeds.
    const third = await auth.put(`/api/design/assembly/${id}/skeleton`)
      .send({ equations: SKELETON_EQUATIONS, clientSavedAt: first.body.lastContentSavedAt });
    expect(third.status).toBe(200);
  });
});

describe('Skeleton VCS round-trip (REQ 913)', () => {
  it('bundle serialize → deserialize is lossless', async () => {
    const repo = { repoType: 'assembly', repoId: 'skel-rt' };
    const bundle = {
      assemblyDoc: {
        nextInstanceSeq: 2, nextMateSeq: 1, nextPatternSeq: 1, nextDisplayStateSeq: 1,
        instances: [{ instanceId: 'i1', partID: 5, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
        mates: [], patterns: [], explode: { offsets: {}, factor: 1 }, displayStates: [],
      },
      sketchDoc: SKELETON_SKETCH_DOC,
      featureTree: SKELETON_FEATURE_TREE,
      equations: SKELETON_EQUATIONS,
    };
    const tree = await assemblySerialize(repo, bundle, db);
    const back = await assemblyDeserialize(repo, tree, db);
    expect(back).toEqual(bundle);
  });

  it('skeleton survives checkin → switch branch → switch back', async () => {
    const auth = await authenticatedRequest();
    const id = await editableAssembly(auth);
    await auth.put(`/api/design/assembly/${id}/skeleton`).send({
      sketchDoc: SKELETON_SKETCH_DOC,
      featureTree: SKELETON_FEATURE_TREE,
      equations: SKELETON_EQUATIONS,
    });
    const ci = await auth.post(`/api/design/cad-model/${id}/checkin`).send({ message: 'skeleton' });
    expect(ci.status).toBe(200);

    // Away and back — applyDoc must restore all four columns from the commit.
    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/02' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/02' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });

    const row = await db.DesignCADModel.findByPk(id);
    expect(row.sketchDoc.sketches.s1.name).toBe('Skeleton 1');
    expect(row.featureTree.features[0].id).toBe('dp1');
    expect(row.equations.entries.width.expression).toBe('50');
  });

  it('undo-checkout discards uncommitted skeleton edits', async () => {
    const auth = await authenticatedRequest();
    const id = await editableAssembly(auth);
    await auth.put(`/api/design/assembly/${id}/skeleton`).send({ sketchDoc: SKELETON_SKETCH_DOC });
    await auth.post(`/api/design/cad-model/${id}/checkin`).send({ message: 'skeleton v1' });

    await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
    const edited = JSON.parse(JSON.stringify(SKELETON_SKETCH_DOC));
    edited.sketches.s1.name = 'Renamed';
    await auth.put(`/api/design/assembly/${id}/skeleton`).send({ sketchDoc: edited });

    const undo = await auth.post(`/api/design/cad-model/${id}/undo-checkout`).send({});
    expect(undo.status).toBe(200);
    expect(undo.body.sketchDoc.sketches.s1.name).toBe('Skeleton 1');
  });

  it('legacy commits (pre-skeleton) deserialize with empty defaults', async () => {
    const repo = { repoType: 'assembly', repoId: 'skel-legacy' };
    const legacyDoc = { nextInstanceSeq: 1, nextMateSeq: 1, instances: [], mates: [] };
    const tree = await assemblySerialize(repo, legacyDoc, db);
    const back = await assemblyDeserialize(repo, tree, db);
    expect(back.assemblyDoc.instances).toEqual([]);
    expect(back.sketchDoc).toEqual({ sketches: {}, nextSketchSeq: 1 });
    expect(back.featureTree).toEqual({ features: [], nextFeatureSeq: 1 });
    expect(back.equations).toEqual({ entries: {} });
  });
});
