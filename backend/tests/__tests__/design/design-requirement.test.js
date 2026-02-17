const { authenticatedRequest, createTestProject } = require('../../helpers');
const request = require('supertest');

const getApp = () => require('../../app');

async function createTestCategory(auth, overrides = {}) {
  const res = await auth.post('/api/design/requirement-category')
    .send({ name: overrides.name || `Cat-${Date.now()}`, ...overrides });
  return res.body;
}

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

describe('Design Requirements API', () => {
  describe('POST /api/design/requirement', () => {
    it('creates a requirement', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/requirement')
        .send({
          description: 'The system shall do X',
          rationale: 'Because Y',
          verification: 'Verify via test',
          validation: 'Validate via review',
          parameter: 'Param Z',
          projectID: project.id,
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.description).toBe('The system shall do X');
      expect(res.body.rationale).toBe('Because Y');
      expect(res.body.ownerUserID).toBe(auth.user.id);
      expect(res.body.approved).toBe(false);
      expect(res.body.activeFlag).toBe(true);
    });

    it('creates a requirement with category', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const category = await createTestCategory(auth);

      const res = await auth.post('/api/design/requirement')
        .send({
          description: 'Categorized requirement',
          rationale: 'Test rationale',
          verification: 'Test verification',
          validation: 'Test validation',
          projectID: project.id,
          categoryID: category.id,
        });
      expect(res.status).toBe(201);
      expect(res.body.categoryID).toBe(category.id);
    });

    it('rejects missing description', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const res = await auth.post('/api/design/requirement')
        .send({ projectID: project.id });
      expect(res.status).toBe(400);
    });

    it('rejects missing projectID', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.post('/api/design/requirement')
        .send({ description: 'No project' });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .post('/api/design/requirement')
        .send({ description: 'Unauth' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/design/requirement', () => {
    it('lists all active requirements', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      await createTestRequirement(auth, project.id, { description: 'Req A' });
      await createTestRequirement(auth, project.id, { description: 'Req B' });

      const res = await auth.get('/api/design/requirement');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('includes owner, project, and category associations', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const category = await createTestCategory(auth, { name: 'Assoc-Cat' });

      await createTestRequirement(auth, project.id, {
        description: 'With associations',
        categoryID: category.id,
      });

      const res = await auth.get('/api/design/requirement');
      expect(res.status).toBe(200);
      const req = res.body[0];
      expect(req.owner).toBeDefined();
      expect(req.owner.displayName).toBe('Test User');
      expect(req.project).toBeDefined();
      expect(req.project.id).toBe(project.id);
      expect(req.category).toBeDefined();
      expect(req.category.name).toBe('Assoc-Cat');
    });

    it('filters by projectID', async () => {
      const auth = await authenticatedRequest();
      const project1 = await createTestProject(auth.user, { name: 'Proj1', shortName: 'P1' });
      const project2 = await createTestProject(auth.user, { name: 'Proj2', shortName: 'P2' });

      await createTestRequirement(auth, project1.id, { description: 'Proj1 req' });
      await createTestRequirement(auth, project2.id, { description: 'Proj2 req' });

      const res = await auth.get(`/api/design/requirement?projectID=${project1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].description).toBe('Proj1 req');
    });

    it('excludes inactive requirements', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const req = await createTestRequirement(auth, project.id, { description: 'ToDeactivate' });
      await auth.delete(`/api/design/requirement/${req.id}`);

      const res = await auth.get('/api/design/requirement');
      expect(res.status).toBe(200);
      expect(res.body.find(r => r.description === 'ToDeactivate')).toBeUndefined();
    });
  });

  describe('GET /api/design/requirement/:id', () => {
    it('gets requirement by id', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'GetById' });

      const res = await auth.get(`/api/design/requirement/${req.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(req.id);
      expect(res.body.description).toBe('GetById');
      expect(res.body.owner).toBeDefined();
      expect(res.body.project).toBeDefined();
    });

    it('returns 404 for nonexistent requirement', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/design/requirement/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/design/requirement/:id', () => {
    it('updates a requirement', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'Original' });

      const res = await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Updated', rationale: 'New rationale' });
      expect(res.status).toBe(200);

      const fetched = await auth.get(`/api/design/requirement/${req.id}`);
      expect(fetched.body.description).toBe('Updated');
      expect(fetched.body.rationale).toBe('New rationale');
    });

    it('returns 404 for nonexistent requirement', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/design/requirement/99999')
        .send({ description: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/design/requirement/:id', () => {
    it('soft deletes a requirement', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'ToDelete' });

      const res = await auth.delete(`/api/design/requirement/${req.id}`);
      expect(res.status).toBe(200);

      const deleted = await db.DesignRequirement.findByPk(req.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent requirement', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/design/requirement/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('Hierarchy (REQ-DES-002)', () => {
    it('creates child requirement with parentRequirementID', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const parent = await createTestRequirement(auth, project.id, { description: 'Parent' });
      const child = await createTestRequirement(auth, project.id, {
        description: 'Child',
        parentRequirementID: parent.id,
      });

      expect(child.parentRequirementID).toBe(parent.id);
    });

    it('GET returns parent association', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const parent = await createTestRequirement(auth, project.id, { description: 'Parent' });
      const child = await createTestRequirement(auth, project.id, {
        description: 'Child',
        parentRequirementID: parent.id,
      });

      const res = await auth.get(`/api/design/requirement/${child.id}`);
      expect(res.status).toBe(200);
      expect(res.body.parentRequirement).toBeDefined();
      expect(res.body.parentRequirement.id).toBe(parent.id);
      expect(res.body.parentRequirement.description).toBe('Parent');
    });
  });

  describe('Approval (REQ-DES-003)', () => {
    it('approves a requirement', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      const res = await auth.put(`/api/design/requirement/${req.id}/approve`);
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(true);
      expect(res.body.approvedByUserID).toBe(auth.user.id);
    });

    it('unapproves a requirement', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      await auth.put(`/api/design/requirement/${req.id}/approve`);
      const res = await auth.put(`/api/design/requirement/${req.id}/unapprove`);
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(false);
      expect(res.body.approvedByUserID).toBeNull();
    });

    it('GET includes approvedBy association', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      await auth.put(`/api/design/requirement/${req.id}/approve`);
      const res = await auth.get(`/api/design/requirement/${req.id}`);
      expect(res.body.approvedBy).toBeDefined();
      expect(res.body.approvedBy.displayName).toBe('Test User');
    });

    it('returns 404 when approving nonexistent requirement', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/design/requirement/99999/approve');
      expect(res.status).toBe(404);
    });
  });
});
