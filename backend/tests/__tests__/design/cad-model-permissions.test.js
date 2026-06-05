const { authenticatedRequest, createTestPart, createTestUser } = require('../../helpers');

async function grantCadActions(userID, actions) {
  const perms = await db.Permission.findAll({ where: { resource: 'cad' } });
  const allowed = perms.filter(p => actions.includes(p.action));
  if (allowed.length !== actions.length) {
    throw new Error(`Missing cad permissions in DB; expected ${actions} found ${allowed.map(p => p.action)}`);
  }
  await db.UserPermission.bulkCreate(allowed.map(p => ({ userID, permissionID: p.id })));
}

describe('CAD Model permission enforcement (CAD-106)', () => {
  describe('cad.read', () => {
    it('returns 403 on GET /by-part without cad.read', async () => {
      const auth = await authenticatedRequest(undefined, { grantPermissions: false });
      const part = await createTestPart();
      const res = await auth.get(`/api/design/cad-model/by-part/${part.id}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with only cad.read granted', async () => {
      const user = await createTestUser({ displayName: 'cad-reader' });
      const auth = await authenticatedRequest(user, { grantPermissions: false });
      await grantCadActions(auth.user.id, ['read']);
      const part = await createTestPart();
      const res = await auth.get(`/api/design/cad-model/by-part/${part.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('cad.write', () => {
    it('returns 403 on create without cad.write', async () => {
      const user = await createTestUser({ displayName: 'cad-readonly' });
      const auth = await authenticatedRequest(user, { grantPermissions: false });
      await grantCadActions(auth.user.id, ['read']);
      const part = await createTestPart();
      const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      expect(res.status).toBe(403);
    });

    it('returns 403 on PUT without cad.write', async () => {
      const writer = await authenticatedRequest();
      const part = await createTestPart();
      const created = await writer.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const readUser = await createTestUser({ displayName: 'cad-reader-put' });
      const reader = await authenticatedRequest(readUser, { grantPermissions: false });
      await grantCadActions(reader.user.id, ['read']);
      const res = await reader.put(`/api/design/cad-model/${created.body.id}`).send({ featureTree: { features: [] } });
      expect(res.status).toBe(403);
    });

    it('returns 403 on checkout without cad.write', async () => {
      const writer = await authenticatedRequest();
      const part = await createTestPart();
      const created = await writer.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const readUser = await createTestUser({ displayName: 'cad-reader-checkout' });
      const reader = await authenticatedRequest(readUser, { grantPermissions: false });
      await grantCadActions(reader.user.id, ['read']);
      const res = await reader.post(`/api/design/cad-model/${created.body.id}/checkout`);
      expect(res.status).toBe(403);
    });
  });

  describe('cad.delete', () => {
    it('returns 403 on DELETE without cad.delete', async () => {
      const writer = await authenticatedRequest();
      const part = await createTestPart();
      const created = await writer.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const nodeleteUser = await createTestUser({ displayName: 'cad-nodelete' });
      const nodelete = await authenticatedRequest(nodeleteUser, { grantPermissions: false });
      await grantCadActions(nodelete.user.id, ['read', 'write']);
      const res = await nodelete.delete(`/api/design/cad-model/${created.body.id}`);
      expect(res.status).toBe(403);
    });
  });

  describe('release-to-main is self-service (cad.write); no approval needed', () => {
    it('returns 403 on release without cad.write', async () => {
      const writer = await authenticatedRequest();
      const part = await createTestPart();
      const created = await writer.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const readUser = await createTestUser({ displayName: 'cad-read-only' });
      const reader = await authenticatedRequest(readUser, { grantPermissions: false });
      await grantCadActions(reader.user.id, ['read']);
      const res = await reader.post(`/api/design/cad-model/${created.body.id}/release`);
      expect(res.status).toBe(403);
    });

    it('releases a draft branch onto main with cad.write alone (no submit/approve)', async () => {
      const writerUser = await createTestUser({ displayName: 'cad-writer' });
      const writer = await authenticatedRequest(writerUser, { grantPermissions: false });
      await grantCadActions(writer.user.id, ['read', 'write']);
      const part = await createTestPart();
      const created = await writer.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      const res = await writer.post(`/api/design/cad-model/${created.body.id}/release`);
      expect(res.status).toBe(200);
      expect(res.body.commitHash).toBeTruthy();
    });
  });
});
