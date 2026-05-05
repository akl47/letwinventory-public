const { authenticatedRequest, createTestProject, createTestUser } = require('../../helpers');

async function createFeature(auth, projectID, overrides = {}) {
  const res = await auth.post('/api/design/feature').send({
    name: overrides.name || `Feature ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    slug: overrides.slug || `feat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'wf test',
    markdownBody: 'body',
    projectID,
    ...overrides,
  });
  return res.body;
}

describe('Design Feature Workflow (REQ 302, 306)', () => {
  describe('Happy-path transitions', () => {
    it('draft -> in_review via submit', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      expect(feature.reviewState).toBe('draft');

      const res = await auth.post(`/api/design/feature/${feature.id}/submit`);
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe('in_review');
      expect(res.body.submittedAt).toBeDefined();
    });

    it('in_review -> approved via approve', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);

      const res = await auth.post(`/api/design/feature/${feature.id}/approve`);
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe('approved');
      expect(res.body.approvedAt).toBeDefined();
      expect(res.body.approvedByUserID).toBe(auth.user.id);
    });

    it('in_review -> draft via reject', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);

      const res = await auth.post(`/api/design/feature/${feature.id}/reject`).send({ reason: 'needs more detail' });
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe('draft');
    });

    it('approved -> released via release', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);
      await auth.post(`/api/design/feature/${feature.id}/approve`);

      const res = await auth.post(`/api/design/feature/${feature.id}/release`);
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe('released');
      expect(res.body.releasedAt).toBeDefined();
      expect(res.body.releasedByUserID).toBe(auth.user.id);
    });
  });

  describe('Invalid transitions return 4xx with human messages', () => {
    it('cannot approve a draft feature (must submit first)', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);

      const res = await auth.post(`/api/design/feature/${feature.id}/approve`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.error || res.body.message).toMatch(/draft|submit/i);
    });

    it('cannot release a draft feature', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);

      const res = await auth.post(`/api/design/feature/${feature.id}/release`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error || res.body.message).toMatch(/approve|state/i);
    });

    it('cannot release an in_review feature (must approve first)', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);

      const res = await auth.post(`/api/design/feature/${feature.id}/release`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('cannot submit an already-submitted feature', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);

      const res = await auth.post(`/api/design/feature/${feature.id}/submit`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Edit semantics', () => {
    it('updating an approved feature resets it to in_review', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);
      await auth.post(`/api/design/feature/${feature.id}/approve`);

      const res = await auth.put(`/api/design/feature/${feature.id}`).send({ description: 'changed' });
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe('in_review');
    });

    it('PUT on a released feature returns 4xx with a human message', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createFeature(auth, project.id);
      await auth.post(`/api/design/feature/${feature.id}/submit`);
      await auth.post(`/api/design/feature/${feature.id}/approve`);
      await auth.post(`/api/design/feature/${feature.id}/release`);

      const res = await auth.put(`/api/design/feature/${feature.id}`).send({ description: 'changed' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.error || res.body.message).toMatch(/released|read.?only/i);
    });
  });

  describe('Permission gating on approve/release (REQ 306)', () => {
    it('returns 403 on approve without features.approve', async () => {
      const author = await authenticatedRequest();
      const project = await createTestProject(author.user);
      const feature = await createFeature(author, project.id);
      await author.post(`/api/design/feature/${feature.id}/submit`);

      const reviewerUser = await createTestUser({ displayName: 'reviewer-no-approve' });
      const reviewer = await authenticatedRequest(reviewerUser, { grantPermissions: false });
      // Grant features.read + features.write but NOT features.approve.
      const perms = await db.Permission.findAll({ where: { resource: 'features' } });
      const allowed = perms.filter(p => p.action === 'read' || p.action === 'write');
      await db.UserPermission.bulkCreate(allowed.map(p => ({ userID: reviewer.user.id, permissionID: p.id })));

      const res = await reviewer.post(`/api/design/feature/${feature.id}/approve`);
      expect(res.status).toBe(403);
    });

    it('returns 403 on release without features.approve', async () => {
      const author = await authenticatedRequest();
      const project = await createTestProject(author.user);
      const feature = await createFeature(author, project.id);
      await author.post(`/api/design/feature/${feature.id}/submit`);
      await author.post(`/api/design/feature/${feature.id}/approve`);

      const reviewerUser = await createTestUser({ displayName: 'reviewer-no-release' });
      const reviewer = await authenticatedRequest(reviewerUser, { grantPermissions: false });
      const perms = await db.Permission.findAll({ where: { resource: 'features' } });
      const allowed = perms.filter(p => p.action === 'read' || p.action === 'write');
      await db.UserPermission.bulkCreate(allowed.map(p => ({ userID: reviewer.user.id, permissionID: p.id })));

      const res = await reviewer.post(`/api/design/feature/${feature.id}/release`);
      expect(res.status).toBe(403);
    });
  });
});
