const { authenticatedRequest, createTestProject } = require('../../helpers');
const { createTestUser } = require('../../setup');

describe('Project API', () => {
  describe('GET /api/planning/project', () => {
    it('lists all active projects', async () => {
      const auth = await authenticatedRequest();
      await createTestProject(auth.user, { name: 'Project A', shortName: 'PA' });
      await createTestProject(auth.user, { name: 'Project B', shortName: 'PB' });
      await createTestProject(auth.user, { name: 'Inactive', shortName: 'IN', activeFlag: false });

      const res = await auth.get('/api/planning/project');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('includes owner association', async () => {
      const auth = await authenticatedRequest();
      await createTestProject(auth.user, { name: 'OwnerProj', shortName: 'OP' });
      const res = await auth.get('/api/planning/project');
      expect(res.status).toBe(200);
      expect(res.body[0].owner).toBeDefined();
    });
  });

  describe('GET /api/planning/project/top', () => {
    it('lists only top-level projects', async () => {
      const auth = await authenticatedRequest();
      await createTestProject(auth.user, { name: 'Top Project', shortName: 'TP', parentProjectID: null });

      const res = await auth.get('/api/planning/project/top');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });
  });

  describe('GET /api/planning/project/:id', () => {
    it('gets project by id', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user, { name: 'Get Project', shortName: 'GP' });
      const res = await auth.get(`/api/planning/project/${project.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Get Project');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/planning/project/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/planning/project', () => {
    it('creates a project', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/planning/project')
        .send({
          name: 'New Project',
          shortName: 'NP',
          tagColorHex: '00FF00',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('New Project');
      expect(res.body.ownerUserID).toBe(auth.user.id);
    });
  });

  describe('PUT /api/planning/project/:id', () => {
    it('updates a project', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user, { name: 'Upd Project', shortName: 'UP' });
      const res = await auth.put(`/api/planning/project/${project.id}`)
        .send({ name: 'Updated Project', description: 'New desc' });
      expect(res.status).toBe(200);
      const updated = await db.Project.findByPk(project.id);
      expect(updated.name).toBe('Updated Project');
    });
  });

  describe('DELETE /api/planning/project/:id', () => {
    it('soft deletes a project', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user, { name: 'Del Project', shortName: 'DP' });
      const res = await auth.delete(`/api/planning/project/${project.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Project.findByPk(project.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
