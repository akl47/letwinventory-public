'use strict';

// REQ 874/875/876 — lock lifecycle: checkout never exposes another user's
// uncommitted edits (takeover + stash), locks renew (sliding on save, explicit
// renew endpoint), expired locks reject writes, and check-in can keep the lock.
//
// NB: Users.displayName is UNIQUE and the default test user is always
// "Test User", so second users are created with distinct identities.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

let _u = 0;
function distinctUser(name) {
  _u++;
  return db.User.create({ googleID: `g-${name}-${_u}`, displayName: `${name}-${_u}`, email: `${name}-${_u}@example.com`, activeFlag: true });
}

async function createModel(auth, partId) {
  const r = await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' });
  return r.body;
}

const TREE_A = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const TREE_B = {
  features: [
    { id: 'f1', type: 'origin' },
    { id: 'f2', type: 'extrude', sketchId: 's1', distance: 7, endCondition: { kind: 'blind' } },
  ],
  nextFeatureSeq: 3,
};

/** Force the model row's lock into the past so it reads as expired. */
async function expireLock(modelId) {
  const row = await db.DesignCADModel.findByPk(modelId);
  await row.update({ lockExpiresAt: new Date(Date.now() - 60_000) });
}

describe('CAD lock lifecycle (REQ 874-876)', () => {
  test('renew-lock extends expiry for the holder; others get 423', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});

    const before = (await db.DesignCADModel.findByPk(model.id)).lockExpiresAt;
    const renew = await a.post(`/api/design/cad-model/${model.id}/renew-lock`).send({});
    expect(renew.status).toBe(200);
    expect(new Date(renew.body.lockExpiresAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());

    const b = await authenticatedRequest(await distinctUser('eve'));
    const other = await b.post(`/api/design/cad-model/${model.id}/renew-lock`).send({});
    expect(other.status).toBe(423);
  });

  test('renew-lock REVIVES an expired lock for the attributed holder (REQ 875)', async () => {
    // Browsers throttle timers in hidden tabs / during sleep, so the editor's
    // heartbeat can miss the TTL. Attribution intact = nobody took the lock
    // (takeover/sweep/force-unlock all change or clear lockedByUserID), so the
    // returning holder revives silently instead of hitting the lost banner.
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await expireLock(model.id);

    const renew = await a.post(`/api/design/cad-model/${model.id}/renew-lock`).send({});
    expect(renew.status).toBe(200);
    expect(new Date(renew.body.lockExpiresAt).getTime()).toBeGreaterThan(Date.now());

    // The revived checkout accepts saves again.
    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(put.status).toBe(200);
  });

  test('renew-lock on an expired lock is still 423 for a NON-holder', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await expireLock(model.id);

    const b = await authenticatedRequest(await distinctUser('mallory'));
    const other = await b.post(`/api/design/cad-model/${model.id}/renew-lock`).send({});
    expect(other.status).toBe(423);
  });

  test('renew-lock after a takeover is 423 for the original holder (no revival)', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });  // dirty
    await expireLock(model.id);

    const b = await authenticatedRequest(await distinctUser('taker'));
    const take = await b.post(`/api/design/cad-model/${model.id}/checkout`).send({ takeover: true });
    expect(take.status).toBe(200);

    const revive = await a.post(`/api/design/cad-model/${model.id}/renew-lock`).send({});
    expect(revive.status).toBe(423);
  });

  test('a save against an EXPIRED lock is rejected 423 and does not apply', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await expireLock(model.id);

    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(put.status).toBe(423);
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.featureTree.features).toHaveLength(TREE_A.features.length);
  });

  test('a successful save slides the lock expiry forward', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    // Age the lock (still valid, expiring soon) so the renewal is observable.
    const row = await db.DesignCADModel.findByPk(model.id);
    const soon = new Date(Date.now() + 60_000);
    await row.update({ lockExpiresAt: soon });

    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(put.status).toBe(200);
    const after = (await db.DesignCADModel.findByPk(model.id)).lockExpiresAt;
    expect(new Date(after).getTime()).toBeGreaterThan(soon.getTime());
  });

  test('takeover of an expired DIRTY lock requires confirmation and stashes the prior work', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    // A's uncommitted edit → dirty working copy.
    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(put.status).toBe(200);
    await expireLock(model.id);

    const b = await authenticatedRequest(await distinctUser('bob'));
    // Without takeover: refused with an explanatory 409, nothing changes.
    const refused = await b.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('TAKEOVER_REQUIRED');

    // With takeover: succeeds, stashes A's dirty doc, resets to the branch head.
    const co = await b.post(`/api/design/cad-model/${model.id}/checkout`).send({ takeover: true });
    expect(co.status).toBe(200);
    expect(co.body.stashedTo).toMatch(/^stash\//);
    expect(co.body.lockedByUserID).toBe(b.user.id);
    // Working copy no longer carries A's uncommitted extrude.
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.featureTree.features.find((f) => f.id === 'f2')).toBeUndefined();
    expect(row.dirty).toBe(false);

    // The stash branch exists and its commit reproduces A's dirty doc,
    // authored by A.
    const branches = await b.get(`/api/design/cad-model/${model.id}/branches`);
    expect(branches.status).toBe(200);
    const stash = branches.body.find((br) => br.name === co.body.stashedTo);
    expect(stash).toBeTruthy();
    const doc = await b.get(`/api/design/cad-model/${model.id}/commits/${stash.targetHash}/doc`);
    expect(doc.status).toBe(200);
    expect(doc.body.featureTree.features.find((f) => f.id === 'f2')).toBeTruthy();
  });

  test('clean checkout after expiry fast-forwards to the branch head (no inheritance)', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    // A checks in (clean) — then the lock expires.
    await a.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'extrude' });
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await expireLock(model.id);

    const b = await authenticatedRequest(await distinctUser('carol'));
    const co = await b.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(co.status).toBe(200);
    // No stash needed for a clean copy; B sees the committed head.
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.featureTree.features.find((f) => f.id === 'f2')).toBeTruthy();
    expect(row.lockedByUserID).toBe(b.user.id);
  });

  test('check-in with keepCheckedOut retains and renews the lock', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });

    const ci = await a.post(`/api/design/cad-model/${model.id}/checkin`)
      .send({ message: 'checkpoint', keepCheckedOut: true });
    expect(ci.status).toBe(200);
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.lockedByUserID).toBe(a.user.id);
    expect(new Date(row.lockExpiresAt).getTime()).toBeGreaterThan(Date.now());

    // A can keep editing without another checkout.
    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_A });
    expect(put.status).toBe(200);
  });

  test('check-in without the flag still releases the lock (unchanged default)', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await a.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'plain' });
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.lockedByUserID).toBeNull();
  });
});
