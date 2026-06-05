'use strict';

// REQ 708/709 — the per-model default camera view. It is a view preference,
// so saving it must NOT require a checkout, and it round-trips on the model.

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

const VIEW = { theta: 0.7853, phi: 1.0471, distance: 240, target: [1, 2, 3] };

describe('CAD default view', () => {
  test('saves the default view without a checkout and returns it on the model', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    // No checkout — this is a preference, not an edit.
    const save = await auth.post(`/api/design/cad-model/${model.id}/default-view`).send(VIEW);
    expect(save.status).toBe(200);
    expect(save.body.defaultView).toEqual(VIEW);

    const got = await auth.get(`/api/design/cad-model/${model.id}`);
    expect(got.status).toBe(200);
    expect(got.body.defaultView).toEqual(VIEW);
  });

  test('rejects a malformed view (400)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    const bad = await auth.post(`/api/design/cad-model/${model.id}/default-view`).send({ theta: 0.1, phi: 0.2 });
    expect(bad.status).toBe(400);
  });

  test('requires cad write permission (403)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    const noPerm = await authenticatedRequest(await distinctUser('noperm'), { grantPermissions: false });
    const save = await noPerm.post(`/api/design/cad-model/${model.id}/default-view`).send(VIEW);
    expect(save.status).toBe(403);
  });
});
