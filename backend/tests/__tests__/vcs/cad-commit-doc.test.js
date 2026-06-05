'use strict';

// REQ 743 — GET /:id/commits/:hash/doc reconstructs a historical commit's CAD
// document (featureTree / sketchDoc / equations) from the content-addressed
// object store, without touching the working copy. Powers the editor's
// read-only "Open version" view.

const { authenticatedRequest, createTestPart } = require('../../helpers');

async function createModel(auth, partId) {
  const r = await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' });
  return r.body;
}

describe('CAD commit doc endpoint', () => {
  test('returns the featureTree/sketchDoc/equations committed at a given hash', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    // Edit the working copy, then commit a distinctive feature tree.
    const tree = { features: [{ id: 'f1', type: 'origin' }, { id: 'fa-xyz', type: 'extrude', sketchId: 'sa-1' }], nextFeatureSeq: 3 };
    await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: tree });
    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'with extrude' });
    expect(ci.status).toBe(200);
    const hash = ci.body.commitHash;

    const doc = await auth.get(`/api/design/cad-model/${model.id}/commits/${hash}/doc`);
    expect(doc.status).toBe(200);
    expect(doc.body.hash).toBe(hash);
    expect(doc.body.message).toBe('with extrude');
    const ids = (doc.body.featureTree.features || []).map(f => f.id);
    expect(ids).toContain('fa-xyz');
  });

  test('reading an old commit does not reflect later working-copy edits', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'old-feat', type: 'extrude' }], nextFeatureSeq: 3 } });
    const first = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'v1' });
    const firstHash = first.body.commitHash;

    // A later edit + commit must not change what the first commit's doc returns.
    await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'new-feat', type: 'extrude' }], nextFeatureSeq: 3 } });
    await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'v2' });

    const doc = await auth.get(`/api/design/cad-model/${model.id}/commits/${firstHash}/doc`);
    expect(doc.status).toBe(200);
    const ids = (doc.body.featureTree.features || []).map(f => f.id);
    expect(ids).toContain('old-feat');
    expect(ids).not.toContain('new-feat');
  });

  test('unknown commit hash → 404', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    const doc = await auth.get(`/api/design/cad-model/${model.id}/commits/${'0'.repeat(64)}/doc`);
    expect(doc.status).toBe(404);
  });
});
