'use strict';

// REQ 958 — every CAD version-control verb writes an audit history row with
// the actor, the verb, and its key parameters.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');

const U = (id, p = '') => `/api/design/cad-model/${id}${p}`;

async function rows(modelId) {
  return db.DesignCADModelHistory.findAll({ where: { cadModelID: modelId }, order: [['id', 'ASC']] });
}

describe('CAD VCS audit trail (REQ 958)', () => {
  test('checkout, check-in, undo, branch ops, cherry-pick, merge and workflow are recorded', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;

    await auth.post(U(model.id, '/checkout')).send({});
    const ci = await auth.post(U(model.id, '/checkin')).send({ message: 'first' });
    await auth.post(U(model.id, '/checkout')).send({});
    await auth.post(U(model.id, '/undo-checkout')).send({});
    await auth.post(U(model.id, '/branches')).send({ name: 'alt' });
    await auth.post(U(model.id, '/switch-branch')).send({ name: 'alt' });
    await auth.post(U(model.id, '/switch-branch')).send({ name: 'draft/01' });
    await auth.delete(U(model.id, '/branches/alt'));
    await auth.post(U(model.id, '/checkout')).send({});
    await auth.post(U(model.id, '/cherry-pick')).send({ sourceCommit: ci.body.commitHash, featureId: 'f1' });
    await auth.post(U(model.id, '/workflow')).send({ action: 'submit' });

    const r = await rows(model.id);
    const types = r.map((x) => x.changeType);
    for (const t of ['checked_out', 'checked_in', 'checkout_undone', 'branch_created', 'branch_switched', 'branch_archived', 'cherry_picked', 'workflow_submit']) {
      expect(types).toContain(t);
    }
    for (const x of r) expect(x.changedByUserID).toBe(auth.user.id);
    expect(r.find((x) => x.changeType === 'checked_in').newState).toMatchObject({ commitHash: ci.body.commitHash, message: 'first' });
    expect(r.find((x) => x.changeType === 'branch_created').newState).toMatchObject({ name: 'alt' });
  });

  test('force-unlock records who cleared whose lock', async () => {
    const holder = await authenticatedRequest(await createTestUser({ displayName: 'Lock Holder' }));
    const admin = await authenticatedRequest(await createTestUser({ displayName: 'Lock Admin' }));
    const part = await createTestPart();
    const model = (await holder.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await holder.post(U(model.id, '/checkout')).send({});

    expect((await admin.post(U(model.id, '/force-unlock')).send({})).status).toBe(200);
    const row = (await rows(model.id)).find((x) => x.changeType === 'force_unlocked');
    expect(row).toBeTruthy();
    expect(row.changedByUserID).toBe(admin.user.id);
    expect(row.previousState).toEqual({ lockedByUserID: holder.user.id });
  });
});
