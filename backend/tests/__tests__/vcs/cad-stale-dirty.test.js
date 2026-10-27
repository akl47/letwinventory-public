'use strict';

// REQ 877 — stale uncommitted-changes warning: lastContentSavedAt is stamped
// ONLY by content-changing saves, so the editor can distinguish "idle with
// dirty work" from activity that merely bumps updatedAt (renames, lock
// heartbeats, default-view saves).

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

async function createModel(auth, partId) {
  const r = await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' });
  return r.body;
}

const TREE_B = {
  features: [
    { id: 'f1', type: 'origin' },
    { id: 'f2', type: 'extrude', sketchId: 's1', distance: 7, endCondition: { kind: 'blind' } },
  ],
  nextFeatureSeq: 3,
};

async function checkedOutModel(a) {
  const part = await createTestPart();
  const model = await createModel(a, part.id);
  await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  return model;
}

describe('CAD stale-dirty timestamp (REQ 877)', () => {
  test('a content save sets lastContentSavedAt and returns it in the response', async () => {
    const a = await authenticatedRequest();
    const model = await checkedOutModel(a);

    const before = Date.now();
    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(put.status).toBe(200);
    expect(put.body.lastContentSavedAt).toBeTruthy();
    const ts = new Date(put.body.lastContentSavedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('a name-only save does NOT touch lastContentSavedAt', async () => {
    const a = await authenticatedRequest();
    const model = await checkedOutModel(a);
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    const stamped = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;

    const rename = await a.put(`/api/design/cad-model/${model.id}`).send({ name: 'Renamed' });
    expect(rename.status).toBe(200);
    const after = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;
    expect(new Date(after).getTime()).toBe(new Date(stamped).getTime());
  });

  test('renew-lock and default-view do NOT touch lastContentSavedAt', async () => {
    const a = await authenticatedRequest();
    const model = await checkedOutModel(a);
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    const stamped = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;

    expect((await a.post(`/api/design/cad-model/${model.id}/renew-lock`).send({})).status).toBe(200);
    expect((await a.post(`/api/design/cad-model/${model.id}/default-view`)
      .send({ theta: 0.5, phi: 1.1, distance: 40, target: [0, 0, 0] })).status).toBe(200);

    const after = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;
    expect(new Date(after).getTime()).toBe(new Date(stamped).getTime());
  });

  test('check-in clears dirty but leaves lastContentSavedAt as-is', async () => {
    const a = await authenticatedRequest();
    const model = await checkedOutModel(a);
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    const stamped = (await db.DesignCADModel.findByPk(model.id)).lastContentSavedAt;

    const ci = await a.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'extrude' });
    expect(ci.status).toBe(200);
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.dirty).toBe(false);
    expect(new Date(row.lastContentSavedAt).getTime()).toBe(new Date(stamped).getTime());
  });
});
