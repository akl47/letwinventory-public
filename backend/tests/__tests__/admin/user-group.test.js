const { authenticatedRequest, createTestGroup, addUserToGroup, assignAllPermissions } = require('../../helpers');
const { createTestUser } = require('../../setup');
const request = require('supertest');

const getApp = () => require('../../app');

describe('User Groups API', () => {
  async function setupAdmin() {
    const auth = await authenticatedRequest();
    await assignAllPermissions(auth.user.id);
    return auth;
  }

  describe('POST /api/admin/group', () => {
    it('creates a group', async () => {
      const auth = await setupAdmin();
      const res = await auth.post('/api/admin/group')
        .send({ name: 'Engineers', description: 'Engineering team' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Engineers');
      expect(res.body.description).toBe('Engineering team');
      expect(res.body.activeFlag).toBe(true);
    });

    it('rejects duplicate name', async () => {
      const auth = await setupAdmin();
      await auth.post('/api/admin/group').send({ name: 'DupGroup' });
      const res = await auth.post('/api/admin/group').send({ name: 'DupGroup' });
      expect(res.status).toBe(400);
    });

    it('rejects missing name', async () => {
      const auth = await setupAdmin();
      const res = await auth.post('/api/admin/group')
        .send({ description: 'No name' });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .post('/api/admin/group')
        .send({ name: 'Unauth' });
      expect(res.status).toBe(401);
    });

    it('returns 403 without admin permission', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      // User has no permissions — should get 403
      const res = await auth.post('/api/admin/group')
        .send({ name: 'NoPerms' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/group', () => {
    it('lists active groups', async () => {
      const auth = await setupAdmin();
      await auth.post('/api/admin/group').send({ name: 'Group-A' });
      await auth.post('/api/admin/group').send({ name: 'Group-B' });

      const res = await auth.get('/api/admin/group');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Includes seeded Admin group + 2 created
      const names = res.body.map(g => g.name);
      expect(names).toContain('Group-A');
      expect(names).toContain('Group-B');
    });

    it('excludes inactive groups', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group').send({ name: 'ToDeactivate' });
      await auth.delete(`/api/admin/group/${created.body.id}`);

      const res = await auth.get('/api/admin/group');
      expect(res.status).toBe(200);
      expect(res.body.find(g => g.name === 'ToDeactivate')).toBeUndefined();
    });
  });

  describe('GET /api/admin/group/:id', () => {
    it('gets group with members and permissions', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'DetailGroup' });
      const groupId = created.body.id;

      const res = await auth.get(`/api/admin/group/${groupId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(groupId);
      expect(res.body.name).toBe('DetailGroup');
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(Array.isArray(res.body.permissions)).toBe(true);
    });

    it('returns 404 for nonexistent group', async () => {
      const auth = await setupAdmin();
      const res = await auth.get('/api/admin/group/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/group/:id', () => {
    it('updates group name and description', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'OldName' });

      const res = await auth.put(`/api/admin/group/${created.body.id}`)
        .send({ name: 'NewName', description: 'Updated desc' });
      expect(res.status).toBe(200);

      const fetched = await auth.get(`/api/admin/group/${created.body.id}`);
      expect(fetched.body.name).toBe('NewName');
      expect(fetched.body.description).toBe('Updated desc');
    });

    it('updates group permissions', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'PermGroup' });

      // Get some permission IDs
      const permsRes = await auth.get('/api/admin/permission');
      const readPerms = permsRes.body.filter(p => p.action === 'read');
      const permissionIds = readPerms.map(p => p.id);

      const res = await auth.put(`/api/admin/group/${created.body.id}`)
        .send({ permissionIds });
      expect(res.status).toBe(200);

      const fetched = await auth.get(`/api/admin/group/${created.body.id}`);
      expect(fetched.body.permissions.length).toBe(permissionIds.length);
    });

    it('returns 404 for nonexistent group', async () => {
      const auth = await setupAdmin();
      const res = await auth.put('/api/admin/group/99999')
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/group/:id', () => {
    it('soft deletes a group', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'ToDelete' });

      const res = await auth.delete(`/api/admin/group/${created.body.id}`);
      expect(res.status).toBe(200);

      const deleted = await db.UserGroup.findByPk(created.body.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent group', async () => {
      const auth = await setupAdmin();
      const res = await auth.delete('/api/admin/group/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/admin/group/:id/member', () => {
    it('adds a user to a group', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'MemberGroup' });
      const newUser = await createTestUser({ displayName: 'Member User' });

      const res = await auth.post(`/api/admin/group/${created.body.id}/member`)
        .send({ userID: newUser.id });
      expect(res.status).toBe(201);

      const fetched = await auth.get(`/api/admin/group/${created.body.id}`);
      expect(fetched.body.members.length).toBe(1);
      expect(fetched.body.members[0].id).toBe(newUser.id);
    });

    it('rejects duplicate membership', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'DupMemberGroup' });
      const newUser = await createTestUser({ displayName: 'Dup Member' });

      await auth.post(`/api/admin/group/${created.body.id}/member`)
        .send({ userID: newUser.id });
      const res = await auth.post(`/api/admin/group/${created.body.id}/member`)
        .send({ userID: newUser.id });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/group/:id/member/:userId', () => {
    it('removes a user from a group', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'RemoveGroup' });
      const newUser = await createTestUser({ displayName: 'Remove Me' });

      await auth.post(`/api/admin/group/${created.body.id}/member`)
        .send({ userID: newUser.id });
      const res = await auth.delete(`/api/admin/group/${created.body.id}/member/${newUser.id}`);
      expect(res.status).toBe(200);

      const fetched = await auth.get(`/api/admin/group/${created.body.id}`);
      expect(fetched.body.members.length).toBe(0);
    });

    it('returns 404 for nonexistent membership', async () => {
      const auth = await setupAdmin();
      const created = await auth.post('/api/admin/group')
        .send({ name: 'NoMemberGroup' });
      const res = await auth.delete(`/api/admin/group/${created.body.id}/member/99999`);
      expect(res.status).toBe(404);
    });
  });
});
