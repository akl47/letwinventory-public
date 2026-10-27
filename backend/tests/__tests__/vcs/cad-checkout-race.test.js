'use strict';

// REQ 951 — checkout lock acquisition is atomic: of two concurrent checkouts
// by different users exactly one wins; the other gets 423.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');

// True concurrency needs Postgres: the SQLite test DB shares one connection,
// so two overlapping transactions fail with "cannot start a transaction within
// a transaction" regardless of the locking logic. Runs when the suite is
// pointed at Postgres; the expired-lock claim below runs everywhere.
const isPostgres = db.sequelize.getDialect() === 'postgres';

describe('Concurrent checkout (REQ 951)', () => {
  (isPostgres ? test : test.skip)('exactly one of two simultaneous checkouts succeeds', async () => {
    const alice = await authenticatedRequest(await createTestUser({ displayName: 'Race Alice' }));
    const bob = await authenticatedRequest(await createTestUser({ displayName: 'Race Bob' }));
    const part = await createTestPart();
    const model = (await alice.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;

    const [a, b] = await Promise.all([
      alice.post(`/api/design/cad-model/${model.id}/checkout`).send({}),
      bob.post(`/api/design/cad-model/${model.id}/checkout`).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 423]);

    const winner = a.status === 200 ? alice : bob;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.error).toMatch(/checked out by Race (Alice|Bob)/);
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.lockedByUserID).toBe(winner.user.id);
  });

  test('a checkout computed from a stale read loses to a lock taken since (conditional claim)', async () => {
    const cadvcs = require('../../../services/vcs/cadVcsService');
    const alice = await createTestUser({ displayName: 'Stale Alice' });
    const bob = await createTestUser({ displayName: 'Stale Bob' });
    const auth = await authenticatedRequest(alice);
    const part = await createTestPart();
    const created = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;

    // Bob reads the row while it is still unlocked...
    const bobsStaleCopy = await db.DesignCADModel.findByPk(created.id);
    // ...then Alice checks out.
    await cadvcs.checkout(await db.DesignCADModel.findByPk(created.id), alice.id, {});
    // Bob's checkout passes the in-memory check (his copy says "unlocked") but
    // the conditional UPDATE must refuse it.
    await expect(cadvcs.checkout(bobsStaleCopy, bob.id, {})).rejects.toMatchObject({ statusCode: 423 });
    expect((await db.DesignCADModel.findByPk(created.id)).lockedByUserID).toBe(alice.id);
  });

  test('the claim succeeds when the prior lock has expired', async () => {
    const alice = await authenticatedRequest(await createTestUser({ displayName: 'Exp Alice' }));
    const bob = await authenticatedRequest(await createTestUser({ displayName: 'Exp Bob' }));
    const part = await createTestPart();
    const model = (await alice.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    await alice.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    await db.DesignCADModel.update({ lockExpiresAt: new Date(Date.now() - 1000) }, { where: { id: model.id } });
    const res = await bob.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(res.status).toBe(200);
    expect(res.body.lockedByUserID).toBe(bob.user.id);
  });
});
