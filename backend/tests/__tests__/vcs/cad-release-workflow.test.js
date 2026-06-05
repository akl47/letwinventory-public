'use strict';

// Branch-based CAD versioning (redesign): `main` is protected; work happens on
// draft branches whose revision is DERIVED (highest released numeric + 1, shared
// by all drafts); submitting a branch opens review and on approval it is RELEASED
// onto main (mint the numeric Part rev, freeze + write-once tag, archive the
// branch); a behind-main branch must rebase first (which bumps its derived rev);
// the production letter tier is retained off main. Route-level; kernel stub backs freeze.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const cadvcs = require('../../../services/vcs/cadVcsService');
const vcs = require('../../../services/vcs/vcsService');
const partRevisionService = require('../../../services/partRevisionService');
const cadKernelClient = require('../../../services/cadKernelClient');

function stubKernel() {
  const stub = {
    call: jest.fn().mockImplementation((method, params) => {
      if (method === 'exportStep') return Promise.resolve({ step: 'ISO-10303-21;\nSTEP\nEND-ISO-10303-21;' });
      if (method === 'exportStl') return Promise.resolve({ stlBase64: Buffer.from('stl-bytes').toString('base64') });
      return Promise.resolve({
        brepBytes: `BREP-${params.featureId || 'x'}`,
        faces: [{ faceId: `${params.featureId}-f0`, persistentName: `${params.featureId}-f0`, isFlat: true, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
        topology: { vertices: [], edges: [] },
      });
    }),
  };
  jest.spyOn(cadKernelClient, 'getDefaultClient').mockReturnValue(stub);
  return stub;
}

const url = (id, p) => `/api/design/cad-model/${id}${p}`;

async function createModel(auth, partId) {
  return (await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' })).body;
}
// A model checked in on its auto-created draft branch (draft/01), lock released.
async function checkedIn(auth, partId) {
  const model = await createModel(auth, partId);
  await auth.post(url(model.id, '/checkout')).send({});
  await auth.post(url(model.id, '/checkin')).send({ message: 'init' }); // releases the lock
  return model;
}
// Release the model's current draft branch onto main — self-service, no approval.
async function releaseToMain(auth, id) {
  return auth.post(url(id, '/release')).send({});
}

describe('CAD branch-based versioning + release', () => {
  beforeEach(() => stubKernel());
  afterEach(() => jest.restoreAllMocks());

  test('a new model lands on draft/01 (editable); main is protected', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);
    expect(model.branchName).toBe('draft/01');
    expect(model.displayRevision).toBe('01');
    expect(model.releaseLocked).toBeFalsy();

    // The draft branch is checkoutable + editable.
    expect((await auth.post(url(model.id, '/checkout')).send({})).status).toBe(200);
    await auth.post(url(model.id, '/checkin')).send({ message: 'init' }); // release the lock

    // main is protected: switching onto it blocks checkout + edits (423).
    expect((await auth.post(url(model.id, '/switch-branch')).send({ name: 'main' })).status).toBe(200);
    expect((await auth.post(url(model.id, '/checkout')).send({})).status).toBe(423);
    expect((await auth.put(url(model.id, '')).send({ name: 'y' })).status).toBe(423);
  });

  test('release establishes rev 01 on main, locks the part, and archives the branch (self-service)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await checkedIn(auth, part.id);

    // No submit/approve needed — release straight from the draft branch.
    const rel = await releaseToMain(auth, model.id);
    expect(rel.status).toBe(200);
    expect(rel.body.revision).toBe('01');
    expect(rel.body.model.branchName).toBe('main');
    expect(rel.body.model.releaseLocked).toBe(true);
    expect(rel.body.model.released).toBe(true);

    const repo = await cadvcs.repoForModel(model);
    expect(await vcs.getRef(repo, '01')).toBeTruthy();        // numeric release tag
    expect(await vcs.getRef(repo, 'draft/01')).toBeFalsy();   // branch archived
    const mainRef = await vcs.getRef(repo, 'main');
    expect(mainRef.targetHash).toBe((await vcs.getRef(repo, '01')).targetHash); // main = the release

    // The minted Part revision '01' is locked and chained back to the origin.
    const newPart = await db.Part.findByPk(rel.body.model.partID);
    expect(newPart.revision).toBe('01');
    expect(newPart.revisionLocked).toBe(true);
    expect(newPart.previousRevisionID).toBe(part.id);
  });

  test('all concurrent draft branches share the derived draft revision', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await checkedIn(auth, part.id); // draft/01

    expect((await auth.post(url(model.id, '/branches')).send({ name: 'draft/alt' })).status).toBe(200);
    // Nothing released yet → both draft branches derive rev '01'.
    expect((await auth.get(url(model.id, ''))).body.displayRevision).toBe('01');
    await auth.post(url(model.id, '/switch-branch')).send({ name: 'draft/alt' });
    expect((await auth.get(url(model.id, ''))).body.displayRevision).toBe('01');
  });

  test('a behind-main branch must rebase before release; rebase bumps its derived rev', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await checkedIn(auth, part.id); // draft/01
    await auth.post(url(model.id, '/branches')).send({ name: 'b' }); // second branch off the same head

    // Release draft/01 → rev 01 on main; main advances past branch b.
    expect((await releaseToMain(auth, model.id)).body.revision).toBe('01');

    // Switch the working copy to b (now behind main).
    expect((await auth.post(url(model.id, '/switch-branch')).send({ name: 'b' })).status).toBe(200);
    expect((await auth.get(url(model.id, ''))).body.behindMain).toBe(true);

    // Approve, but release is blocked while behind main.
    await auth.post(url(model.id, '/workflow')).send({ action: 'submit' });
    await auth.post(url(model.id, '/workflow')).send({ action: 'approve' });
    const blocked = await auth.post(url(model.id, '/release')).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/behind main|rebase/i);

    // Rebase → the derived rev bumps to 02; release now succeeds as rev 02.
    expect((await auth.post(url(model.id, '/rebase')).send({})).status).toBe(200);
    const rebased = (await auth.get(url(model.id, ''))).body;
    expect(rebased.behindMain).toBe(false);
    expect(rebased.displayRevision).toBe('02');

    const rel2 = await auth.post(url(model.id, '/release')).send({});
    expect(rel2.status).toBe(200);
    expect(rel2.body.revision).toBe('02');
  });

  test('merge (reconcile) keeps main latest features and applies selected branch features', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id); // draft/01, origin only
    await auth.post(url(model.id, '/checkout')).send({});
    await auth.post(url(model.id, '/checkin')).send({ message: 'init' });
    // Branch 'feat' off the origin-only state (before any feature lands on main).
    expect((await auth.post(url(model.id, '/branches')).send({ name: 'feat' })).status).toBe(200);

    // On draft/01: add feature f2, then release → main gains f2.
    await auth.post(url(model.id, '/checkout')).send({});
    await auth.put(url(model.id, '')).send({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 } });
    await auth.post(url(model.id, '/checkin')).send({ message: 'add f2' });
    expect((await releaseToMain(auth, model.id)).body.revision).toBe('01');

    // Switch to feat (behind main, origin only), add its own feature f3.
    await auth.post(url(model.id, '/switch-branch')).send({ name: 'feat' });
    await auth.post(url(model.id, '/checkout')).send({});
    await auth.put(url(model.id, '')).send({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f3', type: 'extrude', sketchId: 's3', distance: 5 }], nextFeatureSeq: 4 } });
    await auth.post(url(model.id, '/checkin')).send({ message: 'add f3' });

    // 3D preview of the hypothetical merge — geometry regenerated, not committed.
    const prev = await auth.post(url(model.id, '/reconcile/preview')).send({ branch: 'feat', featureIds: ['f3'] });
    expect(prev.status).toBe(200);
    expect(Array.isArray(prev.body.faces)).toBe(true);

    // Merge main into feat, applying only f3 → main's f2 stays, f3 comes in.
    const r = await auth.post(url(model.id, '/reconcile')).send({ featureIds: ['f3'] });
    expect(r.status).toBe(200);
    const ids = r.body.featureTree.features.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['f1', 'f2', 'f3']));
    expect(r.body.behindMain).toBe(false); // now sits on top of main
  });

  test('production release mints the next letter revision off main (same frozen commit)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await checkedIn(auth, part.id);
    await releaseToMain(auth, model.id); // rev 01 on main; model on main, releaseLocked

    // Production needs its own approval cycle on main.
    expect((await auth.post(url(model.id, '/production-release')).send({})).status).toBe(409);
    await auth.post(url(model.id, '/workflow')).send({ action: 'submit' });
    await auth.post(url(model.id, '/workflow')).send({ action: 'approve' });
    const pr = await auth.post(url(model.id, '/production-release')).send({});
    expect(pr.status).toBe(200);
    expect(pr.body.revision).toBe('A'); // first letter revision

    // The letter tag points at the SAME frozen commit as the numeric release.
    const repo = await cadvcs.repoForModel(model);
    expect((await vcs.getRef(repo, 'A')).targetHash).toBe((await vcs.getRef(repo, '01')).targetHash);
  });

  test('letter revision sequence skips I/O/Q/S/X/Z and rolls to AA', () => {
    const next = partRevisionService.getNextLetterRevision;
    expect(next(null)).toBe('A');
    expect(next('A')).toBe('B');
    expect(next('H')).toBe('J'); // skips I
    expect(next('Y')).toBe('AA');
  });
});
