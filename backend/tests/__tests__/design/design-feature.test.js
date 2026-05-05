const { authenticatedRequest, createTestProject, createTestUser } = require('../../helpers');
const request = require('supertest');

const getApp = () => require('../../app');

async function createTestRequirement(auth, projectID, overrides = {}) {
  const res = await auth.post('/api/design/requirement')
    .send({
      description: 'Test requirement',
      rationale: 'Test rationale',
      verification: 'Test verification',
      validation: 'Test validation',
      projectID,
      ...overrides,
    });
  return res.body;
}

async function createTestFeature(auth, projectID, overrides = {}) {
  const res = await auth.post('/api/design/feature')
    .send({
      name: overrides.name || `Feature ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      slug: overrides.slug || `feat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: 'A test feature',
      markdownBody: '# Heading\n\nBody text.',
      projectID,
      ...overrides,
    });
  return res.body;
}

describe('Design Feature API (REQ 301, 304, 305, 306, 307)', () => {
  describe('POST /api/design/feature (REQ 301, 305)', () => {
    it('creates a feature in draft state', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/feature').send({
        name: 'Kitting & Assemblies',
        slug: 'kitting',
        description: 'Build BOM kits and assemblies',
        markdownBody: '# Kitting\n\nBody.',
        projectID: project.id,
        branchName: 'feature/kitting',
        prURL: 'https://github.com/akl47/letwinventory/pull/42',
        commitRefs: [
          { sha: 'abc1234', url: 'https://github.com/akl47/letwinventory/commit/abc1234', subject: 'Initial impl' },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Kitting & Assemblies');
      expect(res.body.slug).toBe('kitting');
      expect(res.body.markdownBody).toBe('# Kitting\n\nBody.');
      expect(res.body.projectID).toBe(project.id);
      expect(res.body.ownerUserID).toBe(auth.user.id);
      expect(res.body.reviewState).toBe('draft');
      expect(res.body.activeFlag).toBe(true);
      expect(res.body.branchName).toBe('feature/kitting');
      expect(res.body.prURL).toBe('https://github.com/akl47/letwinventory/pull/42');
      expect(res.body.commitRefs).toHaveLength(1);
      expect(res.body.commitRefs[0].sha).toBe('abc1234');
    });

    it('rejects duplicate slug with a human error message', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      await createTestFeature(auth, project.id, { slug: 'duplicate-slug' });

      const res = await auth.post('/api/design/feature').send({
        name: 'Other',
        slug: 'duplicate-slug',
        projectID: project.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.error || res.body.message).toMatch(/slug/i);
      expect(res.body.error || res.body.message).toMatch(/duplicate-slug|already exists/i);
    });

    it('rejects missing name', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/feature').send({
        slug: 'no-name',
        projectID: project.id,
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing projectID', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/design/feature').send({
        name: 'No Project', slug: 'no-project',
      });
      expect(res.status).toBe(400);
    });

    it('rejects malformed commitRefs (not an array)', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/feature').send({
        name: 'Bad commits', slug: 'bad-commits',
        projectID: project.id,
        commitRefs: 'not-an-array',
      });
      expect(res.status).toBe(400);
    });

    it('rejects commitRefs entries missing sha', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/feature').send({
        name: 'Bad shape', slug: 'bad-shape',
        projectID: project.id,
        commitRefs: [{ url: 'https://github.com/x/y/commit/abc' }],
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .post('/api/design/feature')
        .send({ name: 'Unauth', slug: 'unauth', projectID: 1 });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/design/feature', () => {
    it('lists active features', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      await createTestFeature(auth, project.id, { name: 'Feature A', slug: 'a' });
      await createTestFeature(auth, project.id, { name: 'Feature B', slug: 'b' });

      const res = await auth.get('/api/design/feature');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('filters by projectID', async () => {
      const auth = await authenticatedRequest();
      const projectA = await createTestProject(auth.user, { name: 'A' });
      const projectB = await createTestProject(auth.user, { name: 'B' });

      await createTestFeature(auth, projectA.id, { slug: 'in-a' });
      await createTestFeature(auth, projectB.id, { slug: 'in-b' });

      const res = await auth.get(`/api/design/feature?projectID=${projectA.id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].projectID).toBe(projectA.id);
    });

    it('filters by reviewState', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const f1 = await createTestFeature(auth, project.id, { slug: 'draft-feat' });
      const f2 = await createTestFeature(auth, project.id, { slug: 'submitted-feat' });
      await auth.post(`/api/design/feature/${f2.id}/submit`);

      const res = await auth.get('/api/design/feature?reviewState=in_review');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(f2.id);
    });

    it('filters by ownerUserID', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      await createTestFeature(auth, project.id, { slug: 'mine' });
      const res = await auth.get(`/api/design/feature?ownerUserID=${auth.user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every(f => f.ownerUserID === auth.user.id)).toBe(true);
    });
  });

  describe('GET /api/design/feature/:id (REQ 301, 304)', () => {
    it('includes linked requirements', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);
      const req1 = await createTestRequirement(auth, project.id, { description: 'Linked req 1' });
      const req2 = await createTestRequirement(auth, project.id, { description: 'Linked req 2' });

      await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: req1.id });
      await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: req2.id });

      const res = await auth.get(`/api/design/feature/${feature.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.requirements)).toBe(true);
      expect(res.body.requirements.length).toBe(2);
      const ids = res.body.requirements.map(r => r.id).sort();
      expect(ids).toEqual([req1.id, req2.id].sort());
    });

    it('returns 404 for unknown feature id', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/design/feature/9999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/design/feature/:id', () => {
    it('updates editable fields', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);

      const res = await auth.put(`/api/design/feature/${feature.id}`).send({
        description: 'Updated description',
        markdownBody: 'Updated body',
        branchName: 'feature/updated',
      });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Updated description');
      expect(res.body.markdownBody).toBe('Updated body');
      expect(res.body.branchName).toBe('feature/updated');
    });
  });

  describe('DELETE /api/design/feature/:id (REQ 304)', () => {
    it('soft-deletes the feature', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);

      const res = await auth.delete(`/api/design/feature/${feature.id}`);
      expect(res.status).toBe(200);

      const list = await auth.get('/api/design/feature');
      expect(list.body.find(f => f.id === feature.id)).toBeUndefined();
    });

    it('clears designFeatureID on linked requirements (ON DELETE SET NULL)', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);
      const req1 = await createTestRequirement(auth, project.id);

      await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: req1.id });

      await auth.delete(`/api/design/feature/${feature.id}`);

      const reqRes = await auth.get(`/api/design/requirement/${req1.id}`);
      expect(reqRes.status).toBe(200);
      expect(reqRes.body.designFeatureID).toBeNull();
    });
  });

  describe('Requirement linkage (REQ 304)', () => {
    it('POST /:id/link-requirement sets requirement.designFeatureID', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);
      const req1 = await createTestRequirement(auth, project.id);

      const res = await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: req1.id });
      expect(res.status).toBe(200);

      const reqRes = await auth.get(`/api/design/requirement/${req1.id}`);
      expect(reqRes.body.designFeatureID).toBe(feature.id);
    });

    it('DELETE /:id/link-requirement/:reqId clears designFeatureID', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);
      const req1 = await createTestRequirement(auth, project.id);

      await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: req1.id });
      const res = await auth.delete(`/api/design/feature/${feature.id}/link-requirement/${req1.id}`);
      expect(res.status).toBe(200);

      const reqRes = await auth.get(`/api/design/requirement/${req1.id}`);
      expect(reqRes.body.designFeatureID).toBeNull();
    });

    it('rejects linking a non-existent requirement with a human error', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const feature = await createTestFeature(auth, project.id);

      const res = await auth.post(`/api/design/feature/${feature.id}/link-requirement`)
        .send({ requirementID: 99999 });
      expect(res.status).toBe(404);
      expect(res.body.error || res.body.message).toMatch(/requirement/i);
    });
  });

  describe('Permissions (REQ 306)', () => {
    it('returns 403 on POST without features.write', async () => {
      const user = await createTestUser({ displayName: 'no-write-user' });
      const auth = await authenticatedRequest(user, { grantPermissions: false });
      // Grant only features.read so the request is authenticated but unauthorized.
      const readPerm = await db.Permission.findOne({ where: { resource: 'features', action: 'read' } });
      await db.UserPermission.create({ userID: auth.user.id, permissionID: readPerm.id });
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/feature').send({
        name: 'Forbidden', slug: 'forbidden', projectID: project.id,
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 on DELETE without features.delete', async () => {
      const author = await authenticatedRequest();
      const project = await createTestProject(author.user);
      const feature = await createTestFeature(author, project.id);

      const readerUser = await createTestUser({ displayName: 'reader-no-delete' });
      const reader = await authenticatedRequest(readerUser, { grantPermissions: false });
      const readPerm = await db.Permission.findOne({ where: { resource: 'features', action: 'read' } });
      const writePerm = await db.Permission.findOne({ where: { resource: 'features', action: 'write' } });
      await db.UserPermission.bulkCreate([
        { userID: reader.user.id, permissionID: readPerm.id },
        { userID: reader.user.id, permissionID: writePerm.id },
      ]);

      const res = await reader.delete(`/api/design/feature/${feature.id}`);
      expect(res.status).toBe(403);
    });
  });
});
