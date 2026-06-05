'use strict';

// REQ 678 (VC-10), 690 (VC-22), 691 (VC-23 API surface) — the CAD VCS HTTP
// routes: checkout / check-in / release-lock / force-unlock / commits, plus the
// 423 lock guard on update and the cad.write permission gate.
//
// NB: Users.displayName is UNIQUE and the default test user is always
// "Test User", so a second user in the same test must be created explicitly
// with a distinct identity.

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

describe('CAD VCS routes', () => {
  test('checkout locks; check-in commits; commit log lists it', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    const co = await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(co.status).toBe(200);
    expect(co.body.lockedByUserID).toBe(auth.user.id);

    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'first' });
    expect(ci.status).toBe(200);
    expect(ci.body.commitHash).toBeTruthy();

    const log = await auth.get(`/api/design/cad-model/${model.id}/commits`);
    expect(log.status).toBe(200);
    // draft/01 history: the check-in on top of the seeded initial main commit.
    expect(log.body).toHaveLength(2);
    expect(log.body[0].message).toBe('first');
    expect(log.body[1].message).toBe('initial');
  });

  test('a second user is blocked from editing + checking out while locked (423)', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});

    const b = await authenticatedRequest(await distinctUser('bob'));
    const put = await b.put(`/api/design/cad-model/${model.id}`).send({ featureTree: { features: [], nextFeatureSeq: 1 } });
    expect(put.status).toBe(423);
    const co = await b.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(co.status).toBe(423);
  });

  test('the lock holder can edit, then undo checkout', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});

    const put = await a.put(`/api/design/cad-model/${model.id}`).send({ featureTree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 } });
    expect(put.status).toBe(200);
    expect(put.body.dirty).toBe(true);

    const rel = await a.post(`/api/design/cad-model/${model.id}/undo-checkout`).send({});
    expect(rel.status).toBe(200);
    expect(rel.body.lockedByUserID).toBeNull();
  });

  test('checkout requires cad write permission (403)', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);

    const noPerm = await authenticatedRequest(await distinctUser('noperm'), { grantPermissions: false });
    const co = await noPerm.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    expect(co.status).toBe(403);
  });

  test('an admin can force-unlock another user\'s lock', async () => {
    const a = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(a, part.id);
    await a.post(`/api/design/cad-model/${model.id}/checkout`).send({});

    const admin = await authenticatedRequest(await distinctUser('admin')); // granted all perms incl. cad.approve
    const fu = await admin.post(`/api/design/cad-model/${model.id}/force-unlock`).send({});
    expect(fu.status).toBe(200);
    expect(fu.body.lockedByUserID).toBeNull();
  });
});
