const jwt = require('jsonwebtoken');
const { authenticatedRequest, createTestUser } = require('../../helpers');
const { createTestGroup, addUserToGroup, assignGroupPermission } = require('../../helpers');

describe('Admin User Impersonation', () => {
  let admin, target, adminReq;

  beforeEach(async () => {
    admin = await createTestUser({ displayName: 'Admin User', email: 'admin@test.com' });
    target = await createTestUser({ displayName: 'Target User', email: 'target@test.com' });
    adminReq = await authenticatedRequest(admin);
  });

  it('should return 403 without admin.impersonate permission', async () => {
    const noPermReq = await authenticatedRequest(admin, { grantPermissions: false });
    // Grant admin.read but NOT admin.impersonate
    const readPerm = await db.Permission.findOne({ where: { resource: 'admin', action: 'read' } });
    await db.UserPermission.create({ userID: admin.id, permissionID: readPerm.id });

    const res = await noPermReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    expect(res.status).toBe(403);
  });

  it('should successfully impersonate an active user', async () => {
    const res = await adminReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({
      id: target.id,
      displayName: 'Target User',
      email: 'target@test.com'
    });
    expect(Array.isArray(res.body.permissions)).toBe(true);
  });

  it('should return token with target user identity', async () => {
    const res = await adminReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(target.id);
    expect(decoded.email).toBe('target@test.com');
  });

  it('should return token with impersonatedBy claim', async () => {
    const res = await adminReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.impersonatedBy).toBe(admin.id);
  });

  it('should return 400 when impersonating self', async () => {
    const res = await adminReq.post(`/api/admin/user/${admin.id}/impersonate`).send();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('should return 400 when impersonating inactive user', async () => {
    await target.update({ activeFlag: false });
    const res = await adminReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inactive/i);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await adminReq.post('/api/admin/user/99999/impersonate').send();
    expect(res.status).toBe(404);
  });

  it('should produce a token accepted by checkToken middleware', async () => {
    const res = await adminReq.post(`/api/admin/user/${target.id}/impersonate`).send();
    const impersonationToken = res.body.token;

    // Use the impersonation token to call checkToken endpoint
    const { getApp } = require('../../helpers');
    const request = require('supertest');
    const checkRes = await request(getApp())
      .get('/api/auth/user/checkToken')
      .set('Authorization', `Bearer ${impersonationToken}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.valid).toBe(true);
    expect(checkRes.body.user.id).toBe(target.id);
    expect(checkRes.body.impersonatedBy).toBe(admin.id);
  });
});
