const { authenticatedRequest, assignAllPermissions } = require('../../helpers');
const { createTestUser } = require('../../setup');
const request = require('supertest');

const getApp = () => require('../../app');

describe('User Permissions API', () => {
  async function setupAdmin() {
    const auth = await authenticatedRequest();
    await assignAllPermissions(auth.user.id);
    return auth;
  }

  describe('GET /api/admin/permission', () => {
    it('lists all permissions', async () => {
      const auth = await setupAdmin();
      const res = await auth.get('/api/admin/permission');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(29);
    });

    it('each permission has resource and action', async () => {
      const auth = await setupAdmin();
      const res = await auth.get('/api/admin/permission');
      for (const perm of res.body) {
        expect(perm.resource).toBeDefined();
        expect(perm.action).toBeDefined();
      }
    });

    it('returns 403 without admin permission', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.get('/api/admin/permission');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/user', () => {
    it('lists all users', async () => {
      const auth = await setupAdmin();
      const res = await auth.get('/api/admin/user');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 403 without admin permission', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.get('/api/admin/user');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/user/:id', () => {
    it('gets user with groups and permissions', async () => {
      const auth = await setupAdmin();
      const res = await auth.get(`/api/admin/user/${auth.user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(auth.user.id);
      expect(res.body.displayName).toBeDefined();
      expect(Array.isArray(res.body.groups)).toBe(true);
      expect(Array.isArray(res.body.directPermissions)).toBe(true);
    });

    it('returns 404 for nonexistent user', async () => {
      const auth = await setupAdmin();
      const res = await auth.get('/api/admin/user/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/user/:id/permissions', () => {
    it('sets direct permissions for a user', async () => {
      const auth = await setupAdmin();
      const targetUser = await createTestUser({ displayName: 'DirectPerm User' });

      // Get some permission IDs
      const permsRes = await auth.get('/api/admin/permission');
      const readPerms = permsRes.body.filter(p => p.action === 'read');
      const permissionIds = readPerms.map(p => p.id);

      const res = await auth.put(`/api/admin/user/${targetUser.id}/permissions`)
        .send({ permissionIds });
      expect(res.status).toBe(200);

      const fetched = await auth.get(`/api/admin/user/${targetUser.id}`);
      expect(fetched.body.directPermissions.length).toBe(permissionIds.length);
    });

    it('replaces existing permissions on update', async () => {
      const auth = await setupAdmin();
      const targetUser = await createTestUser({ displayName: 'ReplacePerm User' });

      const permsRes = await auth.get('/api/admin/permission');
      const allPerms = permsRes.body;

      // Set to first 5
      await auth.put(`/api/admin/user/${targetUser.id}/permissions`)
        .send({ permissionIds: allPerms.slice(0, 5).map(p => p.id) });

      // Replace with different 3
      await auth.put(`/api/admin/user/${targetUser.id}/permissions`)
        .send({ permissionIds: allPerms.slice(10, 13).map(p => p.id) });

      const fetched = await auth.get(`/api/admin/user/${targetUser.id}`);
      expect(fetched.body.directPermissions.length).toBe(3);
    });

    it('returns 404 for nonexistent user', async () => {
      const auth = await setupAdmin();
      const res = await auth.put('/api/admin/user/99999/permissions')
        .send({ permissionIds: [] });
      expect(res.status).toBe(404);
    });

    it('returns 403 without admin permission', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.put(`/api/admin/user/${auth.user.id}/permissions`)
        .send({ permissionIds: [] });
      expect(res.status).toBe(403);
    });
  });
});
