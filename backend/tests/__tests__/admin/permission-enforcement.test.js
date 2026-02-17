const { authenticatedRequest, addUserToGroup, assignGroupPermission, assignUserPermission, createTestGroup } = require('../../helpers');
const { createTestUser } = require('../../setup');

describe('Permission Enforcement', () => {
  // Create a request with NO permissions (opt out of auto-grant)
  const noPermsRequest = () => authenticatedRequest(null, { grantPermissions: false });

  // Helper to find a permission by resource.action
  async function findPermission(resource, action) {
    return db.Permission.findOne({ where: { resource, action } });
  }

  // Helper to grant a user a specific permission via direct assignment
  async function grantDirect(userId, resource, action) {
    const perm = await findPermission(resource, action);
    await assignUserPermission(userId, perm.id);
  }

  // Helper to grant a group a specific permission
  async function grantGroup(groupId, resource, action) {
    const perm = await findPermission(resource, action);
    await assignGroupPermission(groupId, perm.id);
  }

  describe('Users with no permissions', () => {
    it('returns 403 on GET (read) endpoints', async () => {
      const auth = await noPermsRequest();
      // User has no groups and no direct permissions
      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(403);
    });

    it('returns 403 on POST (write) endpoints', async () => {
      const auth = await noPermsRequest();
      const res = await auth.post('/api/inventory/part')
        .send({ name: 'Test', vendor: 'V', partCategoryID: 1 });
      expect(res.status).toBe(403);
    });

    it('returns 403 on admin endpoints', async () => {
      const auth = await noPermsRequest();
      const res = await auth.get('/api/admin/group');
      expect(res.status).toBe(403);
    });
  });

  describe('Users with direct permissions', () => {
    it('allows access with correct permission', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'parts', 'read');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(200);
    });

    it('denies access with wrong resource permission', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'tasks', 'read');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(403);
    });

    it('denies access with wrong action permission', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'parts', 'delete');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(403);
    });
  });

  describe('Users with group permissions', () => {
    it('allows access via group permission', async () => {
      const auth = await noPermsRequest();
      const group = await createTestGroup({ name: 'Readers' });
      await addUserToGroup(auth.user.id, group.id);
      await grantGroup(group.id, 'parts', 'read');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(200);
    });

    it('denies access when group lacks permission', async () => {
      const auth = await noPermsRequest();
      const group = await createTestGroup({ name: 'NoPartsGroup' });
      await addUserToGroup(auth.user.id, group.id);
      await grantGroup(group.id, 'tasks', 'read');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(403);
    });

    it('denies access when group is inactive', async () => {
      const auth = await noPermsRequest();
      const group = await createTestGroup({ name: 'InactiveGroup' });
      await addUserToGroup(auth.user.id, group.id);
      await grantGroup(group.id, 'parts', 'read');

      // Deactivate the group
      await group.update({ activeFlag: false });

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(403);
    });
  });

  describe('Permission union (group + direct)', () => {
    it('combines group and direct permissions', async () => {
      const auth = await noPermsRequest();

      // Direct: parts.read
      await grantDirect(auth.user.id, 'parts', 'read');

      // Group: tasks.read
      const group = await createTestGroup({ name: 'TaskReaders' });
      await addUserToGroup(auth.user.id, group.id);
      await grantGroup(group.id, 'tasks', 'read');

      // Both should work
      const partsRes = await auth.get('/api/inventory/part');
      expect(partsRes.status).toBe(200);

      const taskRes = await auth.get('/api/planning/project');
      expect(taskRes.status).toBe(200);
    });

    it('combines permissions from multiple groups', async () => {
      const auth = await noPermsRequest();

      const group1 = await createTestGroup({ name: 'PartsReaders' });
      await addUserToGroup(auth.user.id, group1.id);
      await grantGroup(group1.id, 'parts', 'read');

      const group2 = await createTestGroup({ name: 'ProjectReaders' });
      await addUserToGroup(auth.user.id, group2.id);
      await grantGroup(group2.id, 'projects', 'read');

      const partsRes = await auth.get('/api/inventory/part');
      expect(partsRes.status).toBe(200);

      const projRes = await auth.get('/api/planning/project');
      expect(projRes.status).toBe(200);
    });
  });

  describe('Exempt endpoints', () => {
    it('auth endpoints work without permissions', async () => {
      const auth = await noPermsRequest();
      // checkToken is auth/self-service — should work without permissions
      const res = await auth.get('/api/auth/user/checkToken');
      expect(res.status).toBe(200);
    });
  });

  describe('Action-level enforcement', () => {
    it('read permission allows GET but not POST', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'parts', 'read');

      const getRes = await auth.get('/api/inventory/part');
      expect(getRes.status).toBe(200);

      const postRes = await auth.post('/api/inventory/part')
        .send({ name: 'Test', vendor: 'V', partCategoryID: 1 });
      expect(postRes.status).toBe(403);
    });

    it('write permission allows POST but not DELETE', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'parts', 'write');

      // POST should work (write)
      const postRes = await auth.post('/api/inventory/part')
        .send({
          name: 'TestPart',
          description: 'Test part for enforcement',
          vendor: 'TestVendor',
          internalPart: false,
          minimumOrderQuantity: 1,
          partCategoryID: 1,
          serialNumberRequired: false,
          lotNumberRequired: false,
          manufacturer: 'TestMfg',
          manufacturerPN: 'MFG-001',
        });
      expect([200, 201]).toContain(postRes.status);

      // DELETE should fail
      const deleteRes = await auth.delete(`/api/inventory/part/${postRes.body.id}`);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe('Resource mapping', () => {
    it('orders endpoints use orders resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'orders', 'read');

      const res = await auth.get('/api/inventory/order');
      expect(res.status).toBe(200);
    });

    it('harness endpoints use harness resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'harness', 'read');

      const res = await auth.get('/api/parts/harness');
      expect(res.status).toBe(200);
    });

    it('task endpoints use tasks resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'tasks', 'read');

      const res = await auth.get('/api/planning/task');
      expect(res.status).toBe(200);
    });

    it('project endpoints use projects resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'projects', 'read');

      const res = await auth.get('/api/planning/project');
      expect(res.status).toBe(200);
    });

    it('parts endpoints use parts resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'parts', 'read');

      const res = await auth.get('/api/inventory/part');
      expect(res.status).toBe(200);
    });

    it('equipment endpoints use equipment resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'equipment', 'read');

      const res = await auth.get('/api/inventory/equipment');
      expect(res.status).toBe(200);
    });

    it('design endpoints use requirements resource', async () => {
      const auth = await noPermsRequest();
      await grantDirect(auth.user.id, 'requirements', 'read');

      const res = await auth.get('/api/design/requirement');
      expect(res.status).toBe(200);
    });
  });
});
