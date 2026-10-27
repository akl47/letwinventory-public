'use strict';

// REQ 744 — GET /api/design/cad-model/kernel/status reports real CAD-kernel
// availability via a `ping` probe. In the test environment no kernel is
// running, so the probe fails and the endpoint reports { online: false }.
// The endpoint always returns HTTP 200 — the payload IS the status.

const { authenticatedRequest } = require('../../helpers');
const db = require('../../../models');

let _u = 0;
function distinctUser(name) {
  _u++;
  return db.User.create({ googleID: `g-${name}-${_u}`, displayName: `${name}-${_u}`, email: `${name}-${_u}@example.com`, activeFlag: true });
}

describe('CAD kernel status endpoint', () => {
  test('reports offline (200) when the kernel is unreachable', async () => {
    const auth = await authenticatedRequest();
    const res = await auth.get('/api/design/cad-model/kernel/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('online');
    expect(res.body.online).toBe(false);
  });

  test('requires cad read permission (403)', async () => {
    const noPerm = await authenticatedRequest(await distinctUser('noperm'), { grantPermissions: false });
    const res = await noPerm.get('/api/design/cad-model/kernel/status');
    expect(res.status).toBe(403);
  });
});
