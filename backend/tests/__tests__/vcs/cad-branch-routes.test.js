'use strict';

// REQ 692-697 (VC-24..29) — branch + cherry-pick HTTP routes.

const { authenticatedRequest, createTestPart } = require('../../helpers');

async function setupCommitted(auth) {
  const part = await createTestPart();
  const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
  await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'init' });
  return model;
}

describe('CAD VCS branch routes', () => {
  test('create + list + switch + archive (guards current)', async () => {
    const auth = await authenticatedRequest();
    const model = await setupCommitted(auth);

    expect((await auth.post(`/api/design/cad-model/${model.id}/branches`).send({ name: 'variant' })).status).toBe(200);

    const list = await auth.get(`/api/design/cad-model/${model.id}/branches`);
    expect(list.status).toBe(200);
    // A new model auto-creates draft/01 and lands on it; plus main and variant.
    expect(list.body.map(b => b.name).sort()).toEqual(['draft/01', 'main', 'variant']);

    const sw = await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'variant' });
    expect(sw.status).toBe(200);
    expect(sw.body.branchName).toBe('variant');

    expect((await auth.delete(`/api/design/cad-model/${model.id}/branches/variant`)).status).toBe(409); // current
    await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'main' });
    expect((await auth.delete(`/api/design/cad-model/${model.id}/branches/variant`)).status).toBe(200);
  });

  test('cherry-pick a feature from another commit', async () => {
    const auth = await authenticatedRequest();
    const model = await setupCommitted(auth); // committed origin-only

    await auth.post(`/api/design/cad-model/${model.id}/branches`).send({ name: 'variant' });
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({}); // check-in released the lock
    await auth.put(`/api/design/cad-model/${model.id}`).send({
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 },
      sketchDoc: { sketches: { s1: { id: 's1', state: { entities: [], constraints: [] } } }, nextSketchSeq: 2 },
    });
    const c1 = (await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'add f2' })).body.commitHash;

    await auth.post(`/api/design/cad-model/${model.id}/switch-branch`).send({ name: 'variant' });
    const cp = await auth.post(`/api/design/cad-model/${model.id}/cherry-pick`).send({ sourceCommit: c1, featureId: 'f2' });
    expect(cp.status).toBe(200);
    expect(cp.body.featureTree.features.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(cp.body.dirty).toBe(true);
  });
});
