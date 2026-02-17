const request = require('supertest');
const { authenticatedRequest, getApp, createTestUser, assignAllPermissions, assignUserPermission } = require('../../helpers');
const { generateToken } = require('../../setup');

const BASE_URL = '/api/auth/api-key';

describe('API Key Management', () => {
  describe('POST / (create)', () => {
    it('should create an API key and return the raw key', async () => {
      const { post } = await authenticatedRequest();
      const res = await post(BASE_URL).send({ name: 'My Script Key' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('My Script Key');
      expect(res.body.key).toMatch(/^lwinv_[0-9a-f]{64}$/);
      expect(res.body.createdAt).toBeDefined();
    });

    it('should reject without authentication', async () => {
      const app = getApp();
      const res = await request(app).post(BASE_URL).send({ name: 'No Auth Key' });

      expect(res.status).toBe(401);
    });

    it('should reject missing name', async () => {
      const { post } = await authenticatedRequest();
      const res = await post(BASE_URL).send({});

      expect(res.status).toBe(400);
    });

    it('should reject empty name', async () => {
      const { post } = await authenticatedRequest();
      const res = await post(BASE_URL).send({ name: '   ' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET / (list)', () => {
    it('should return the user\'s active keys without hash', async () => {
      const { get, post } = await authenticatedRequest();
      await post(BASE_URL).send({ name: 'Key One' });
      await post(BASE_URL).send({ name: 'Key Two' });

      const res = await get(BASE_URL);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBeDefined();
      expect(res.body[0].keyHash).toBeUndefined();
      expect(res.body[0].key).toBeUndefined();
    });

    it('should not return other users\' keys', async () => {
      const user1 = await createTestUser({ googleID: 'g-list-1', email: 'list1@test.com', displayName: 'List User 1' });
      const req1 = await authenticatedRequest(user1);
      await req1.post(BASE_URL).send({ name: 'User1 Key' });

      const user2 = await createTestUser({ googleID: 'g-list-2', email: 'list2@test.com', displayName: 'List User 2' });
      const req2 = await authenticatedRequest(user2);
      const res = await req2.get(BASE_URL);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('should exclude revoked keys', async () => {
      const { get, post, delete: del } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Temp Key' });
      await del(`${BASE_URL}/${createRes.body.id}`);

      const res = await get(BASE_URL);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('DELETE /:id (revoke)', () => {
    it('should soft-delete an API key', async () => {
      const { post, delete: del } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'To Revoke' });

      const res = await del(`${BASE_URL}/${createRes.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('API key revoked');
    });

    it('should return 404 for another user\'s key', async () => {
      const user1 = await createTestUser({ googleID: 'g-revoke-1', email: 'revoke1@test.com', displayName: 'Revoke User 1' });
      const req1 = await authenticatedRequest(user1);
      const createRes = await req1.post(BASE_URL).send({ name: 'User1 Key' });

      const user2 = await createTestUser({ googleID: 'g-revoke-2', email: 'revoke2@test.com', displayName: 'Revoke User 2' });
      const req2 = await authenticatedRequest(user2);
      const res = await req2.delete(`${BASE_URL}/${createRes.body.id}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for nonexistent key', async () => {
      const { delete: del } = await authenticatedRequest();
      const res = await del(`${BASE_URL}/99999`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /token (exchange)', () => {
    it('should return a JWT with correct user info', async () => {
      const { post, user } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Exchange Key' });

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.user.displayName).toBe(user.displayName);
    });

    it('should return permissions', async () => {
      const { post } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Perm Key' });

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.permissions)).toBe(true);
      expect(res.body.permissions.length).toBeGreaterThan(0);
    });

    it('should reject an invalid key', async () => {
      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: 'lwinv_invalid' });

      expect(res.status).toBe(401);
    });

    it('should reject a revoked key', async () => {
      const { post, delete: del } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Revoked Key' });
      await del(`${BASE_URL}/${createRes.body.id}`);

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(401);
    });

    it('should reject key of inactive user', async () => {
      const user = await createTestUser();
      await assignAllPermissions(user.id);
      const token = generateToken(user);
      const app = getApp();

      const createRes = await request(app)
        .post(BASE_URL)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Deactivated User Key' });

      await db.User.update({ activeFlag: false }, { where: { id: user.id } });

      const res = await request(app)
        .post(`${BASE_URL}/token`)
        .send({ key: createRes.body.key });

      expect(res.status).toBe(401);
    });

    it('should update lastUsedAt on exchange', async () => {
      const { post } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Track Usage Key' });

      const app = getApp();
      await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      const apiKey = await db.ApiKey.findByPk(createRes.body.id);
      expect(apiKey.lastUsedAt).not.toBeNull();
    });

    it('should reject missing key', async () => {
      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({});

      expect(res.status).toBe(400);
    });

    it('should return a JWT that works on protected endpoints', async () => {
      const { post } = await authenticatedRequest();
      const createRes = await post(BASE_URL).send({ name: 'Usable Key' });

      const app = getApp();
      const exchangeRes = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });
      const jwt = exchangeRes.body.accessToken;

      const checkRes = await request(app)
        .get('/api/auth/user/checkToken')
        .set('Authorization', `Bearer ${jwt}`);

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.valid).toBe(true);
    });
  });

  describe('Permissions', () => {
    it('should create key with specific permissionIds', async () => {
      const { post } = await authenticatedRequest();
      // Get first 3 permission IDs
      const perms = await db.Permission.findAll({ limit: 3 });
      const permIds = perms.map(p => p.id);

      const res = await post(BASE_URL).send({ name: 'Scoped Key', permissionIds: permIds });

      expect(res.status).toBe(201);
      expect(res.body.permissions).toHaveLength(3);
      expect(res.body.permissions.map(p => p.id).sort()).toEqual(permIds.sort());
    });

    it('should create key with all user perms when permissionIds not provided (backward compat)', async () => {
      const { post } = await authenticatedRequest();
      const res = await post(BASE_URL).send({ name: 'Full Key' });

      expect(res.status).toBe(201);
      expect(res.body.permissions).toBeDefined();
      const allPerms = await db.Permission.findAll();
      expect(res.body.permissions).toHaveLength(allPerms.length);
    });

    it('should reject permissionIds exceeding user permissions', async () => {
      // Create user with only 2 permissions
      const user = await createTestUser({ googleID: 'g-perm-limited', email: 'limited@test.com', displayName: 'Limited' });
      const perms = await db.Permission.findAll({ limit: 2 });
      for (const p of perms) {
        await assignUserPermission(user.id, p.id);
      }
      const token = generateToken(user);
      const app = getApp();

      const allPerms = await db.Permission.findAll();
      const res = await request(app)
        .post(BASE_URL)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Over-scoped', permissionIds: allPerms.map(p => p.id) });

      expect(res.status).toBe(400);
    });

    it('should return only scoped permissions on token exchange', async () => {
      const { post } = await authenticatedRequest();
      const perms = await db.Permission.findAll({ limit: 2 });
      const permIds = perms.map(p => p.id);

      const createRes = await post(BASE_URL).send({ name: 'Scoped Exchange', permissionIds: permIds });

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(2);
    });

    it('should exclude permissions user lost since key creation (intersection)', async () => {
      const user = await createTestUser({ googleID: 'g-perm-intersect', email: 'intersect@test.com', displayName: 'Intersect' });
      await assignAllPermissions(user.id);
      const token = generateToken(user);
      const app = getApp();

      // Create key with all perms
      const createRes = await request(app)
        .post(BASE_URL)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Intersect Key' });

      const allPerms = await db.Permission.findAll();
      expect(createRes.body.permissions).toHaveLength(allPerms.length);

      // Remove one permission from the user
      const removedPerm = allPerms[0];
      await db.UserPermission.destroy({ where: { userID: user.id, permissionID: removedPerm.id } });

      // Exchange token — should not include the removed permission
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(allPerms.length - 1);
      const returnedResources = res.body.permissions.map(p => `${p.resource}.${p.action}`);
      expect(returnedResources).not.toContain(`${removedPerm.resource}.${removedPerm.action}`);
    });

    it('should get permissions for own key', async () => {
      const { post, get } = await authenticatedRequest();
      const perms = await db.Permission.findAll({ limit: 4 });
      const permIds = perms.map(p => p.id);
      const createRes = await post(BASE_URL).send({ name: 'Get Perms Key', permissionIds: permIds });

      const res = await get(`${BASE_URL}/${createRes.body.id}/permissions`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      expect(res.body[0]).toHaveProperty('resource');
      expect(res.body[0]).toHaveProperty('action');
    });

    it('should return 404 when viewing another user\'s key permissions', async () => {
      const user1 = await createTestUser({ googleID: 'g-perm-own-1', email: 'own1@test.com', displayName: 'Owner1' });
      const req1 = await authenticatedRequest(user1);
      const perms = await db.Permission.findAll({ limit: 2 });
      const createRes = await req1.post(BASE_URL).send({ name: 'User1 Perm Key', permissionIds: perms.map(p => p.id) });

      const user2 = await createTestUser({ googleID: 'g-perm-own-2', email: 'own2@test.com', displayName: 'Owner2' });
      const req2 = await authenticatedRequest(user2);

      const getRes = await req2.get(`${BASE_URL}/${createRes.body.id}/permissions`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('Expiration', () => {
    it('should create key with expiresAt', async () => {
      const { post } = await authenticatedRequest();
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const res = await post(BASE_URL).send({ name: 'Expiring Key', expiresAt: futureDate });

      expect(res.status).toBe(201);
      expect(res.body.expiresAt).toBeDefined();
    });

    it('should create key without expiresAt (never expires)', async () => {
      const { post } = await authenticatedRequest();
      const res = await post(BASE_URL).send({ name: 'Forever Key' });

      expect(res.status).toBe(201);
      expect(res.body.expiresAt).toBeNull();
    });

    it('should include expiresAt in list response', async () => {
      const { post, get } = await authenticatedRequest();
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      await post(BASE_URL).send({ name: 'Listed Key', expiresAt: futureDate });

      const res = await get(BASE_URL);

      expect(res.status).toBe(200);
      expect(res.body[0].expiresAt).toBeDefined();
    });

    it('should reject expired key on token exchange', async () => {
      const { post } = await authenticatedRequest();
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const createRes = await post(BASE_URL).send({ name: 'Expired Key', expiresAt: pastDate });

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(401);
    });

    it('should accept non-expired key on token exchange', async () => {
      const { post } = await authenticatedRequest();
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const createRes = await post(BASE_URL).send({ name: 'Valid Key', expiresAt: futureDate });

      const app = getApp();
      const res = await request(app).post(`${BASE_URL}/token`).send({ key: createRes.body.key });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });
  });
});
