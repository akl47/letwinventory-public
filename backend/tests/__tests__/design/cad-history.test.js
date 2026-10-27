'use strict';

// REQ 959 — autosave history rows record which features / sketches / equations
// changed (not full before/after snapshots); the history endpoint is paginated.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

const TREE = (extra = []) => ({ features: [{ id: 'f1', type: 'origin' }, ...extra], nextFeatureSeq: 9 });

describe('CAD autosave history (REQ 959)', () => {
  let auth, model;
  beforeEach(async () => {
    auth = await authenticatedRequest();
    const part = await createTestPart();
    model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  });

  test('an update row lists changed ids and carries no document snapshot', async () => {
    await auth.put(`/api/design/cad-model/${model.id}`).send({
      featureTree: TREE([{ id: 'fa', type: 'extrude', distance: 5 }]),
      equations: { entries: { w: { expression: '10' } } },
    });
    await auth.put(`/api/design/cad-model/${model.id}`).send({
      featureTree: TREE([{ id: 'fa', type: 'extrude', distance: 7 }, { id: 'fb', type: 'extrude', distance: 1 }]),
    });
    const rows = await db.DesignCADModelHistory.findAll({ where: { cadModelID: model.id, changeType: 'updated' }, order: [['id', 'ASC']] });
    expect(rows).toHaveLength(2);
    expect(rows[0].previousState).toBeNull();
    expect(rows[0].newState).toEqual({
      features: { added: ['fa'], removed: [], modified: [] },
      equations: { added: ['w'], removed: [], modified: [] },
    });
    expect(rows[1].newState).toEqual({ features: { added: ['fb'], removed: [], modified: ['fa'] } });
    expect(JSON.stringify(rows[1].newState)).not.toContain('distance');
  });

  test('history is paginated newest-first with a total count', async () => {
    for (let i = 0; i < 5; i++) {
      await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE([{ id: 'fx', type: 'extrude', distance: i + 1 }]) });
    }
    const all = await auth.get(`/api/design/cad-model/${model.id}/history`);
    expect(all.status).toBe(200);
    const total = Number(all.headers['x-total-count']);
    expect(total).toBe(all.body.length);
    const page = await auth.get(`/api/design/cad-model/${model.id}/history?limit=2&offset=1`);
    expect(page.body).toHaveLength(2);
    expect(page.body[0].id).toBe(all.body[1].id);
    expect(new Date(all.body[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(all.body[all.body.length - 1].createdAt).getTime());
  });
});
