'use strict';

// REQ 699 (VC-31) — structural diff HTTP route.

const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('CAD VCS diff routes', () => {
  test('structural diff between two commits', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const c0 = (await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'init' })).body.commitHash;

    await auth.put(`/api/design/cad-model/${model.id}`).send({
      featureTree: { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }], nextFeatureSeq: 3 },
      sketchDoc: { sketches: { s1: { id: 's1', state: { entities: [], constraints: [] } } }, nextSketchSeq: 2 },
    });
    const c1 = (await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'add f2' })).body.commitHash;

    const res = await auth.get(`/api/design/cad-model/${model.id}/commits/${c0}/diff/${c1}`);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.entries.map(e => [e.name, e.status]));
    expect(byName['feature:f2']).toBe('added');
    expect(byName['sketch:s1']).toBe('added');
  });
});
