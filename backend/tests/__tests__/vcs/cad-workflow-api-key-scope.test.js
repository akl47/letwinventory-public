'use strict';

// REQ 943 — workflow transitions use the REQUEST's effective permissions
// (user ∩ API-key scope). A key without cad.approve cannot approve even when
// its owner holds cad.approve.

const request = require('supertest');
const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

const app = () => require('../../app');

async function apiKeyToken(auth, perms) {
  const ids = [];
  for (const [resource, action] of perms) {
    ids.push((await db.Permission.findOne({ where: { resource, action } })).id);
  }
  const created = await auth.post('/api/auth/api-key').send({ name: `k-${Date.now()}`, permissionIds: ids });
  const exch = await request(app()).post('/api/auth/api-key/token').send({ key: created.body.key });
  return exch.body.accessToken;
}

describe('CAD workflow honors API-key scope (REQ 943)', () => {
  test('a cad.read-only key cannot approve, and its action list omits approve', async () => {
    const auth = await authenticatedRequest(); // owner holds every permission
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    expect((await auth.post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'submit' })).status).toBe(200);

    const token = await apiKeyToken(auth, [['cad', 'read']]);
    const viaKey = (r) => r.set('Authorization', `Bearer ${token}`);

    const list = await viaKey(request(app()).get(`/api/design/cad-model/${model.id}/workflow`));
    expect(list.status).toBe(200);
    expect(list.body.actions.map((a) => a.action)).not.toContain('approve');

    const res = await viaKey(request(app()).post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'approve' }));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cad\.approve/);
    expect((await auth.get(`/api/design/cad-model/${model.id}/workflow`)).body.state).toBe('in_review');
  });
});
