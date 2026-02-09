const { authenticatedRequest, createTestHarness } = require('../../helpers');

describe('Harness API', () => {
  describe('GET /api/parts/harness', () => {
    it('lists all harnesses', async () => {
      const auth = await authenticatedRequest();
      await createTestHarness({ name: 'Harness A' });
      await createTestHarness({ name: 'Harness B' });

      const res = await auth.get('/api/parts/harness');
      expect(res.status).toBe(200);
      expect(res.body.harnesses).toBeDefined();
      expect(res.body.harnesses.length).toBe(2);
      expect(res.body.pagination).toBeDefined();
    });

    it('excludes inactive harnesses', async () => {
      const auth = await authenticatedRequest();
      await createTestHarness({ name: 'Active Harness' });
      await createTestHarness({ name: 'Inactive Harness', activeFlag: false });

      const res = await auth.get('/api/parts/harness');
      expect(res.status).toBe(200);
      expect(res.body.harnesses.length).toBe(1);
    });
  });

  describe('GET /api/parts/harness/next-part-number', () => {
    it('returns next part number', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/harness/next-part-number');
      expect(res.status).toBe(200);
      expect(res.body.partNumber).toBeDefined();
      expect(res.body.nextId).toBeDefined();
    });
  });

  describe('GET /api/parts/harness/:id', () => {
    it('gets harness by id', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Get Harness' });
      const res = await auth.get(`/api/parts/harness/${harness.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Get Harness');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/harness/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/harness', () => {
    it('creates a harness', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/harness')
        .send({
          name: 'New Harness',
          revision: 'A',
          harnessData: { connectors: [], cables: [] },
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('New Harness');
      expect(res.body.releaseState).toBe('draft');
    });

    it('creates history entry on creation', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/harness')
        .send({ name: 'History Harness', revision: 'A', harnessData: {} });
      expect(res.status).toBe(201);

      const history = await db.HarnessRevisionHistory.findAll({
        where: { harnessID: res.body.id },
      });
      expect(history.length).toBe(1);
      expect(history[0].changeType).toBe('created');
    });
  });

  describe('PUT /api/parts/harness/:id', () => {
    it('updates a draft harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Draft Update' });
      const res = await auth.put(`/api/parts/harness/${harness.id}`)
        .send({ description: 'Updated description' });
      expect(res.status).toBe(200);
      const updated = await db.WireHarness.findByPk(harness.id);
      expect(updated.description).toBe('Updated description');
    });
  });

  describe('DELETE /api/parts/harness/:id', () => {
    it('soft deletes a harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Delete Harness' });
      const res = await auth.delete(`/api/parts/harness/${harness.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.WireHarness.findByPk(harness.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });

  describe('Revision Control', () => {
    it('submits harness for review', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Review Harness', releaseState: 'draft' });

      const res = await auth.post(`/api/parts/harness/${harness.id}/submit-review`);
      expect(res.status).toBe(200);
      const updated = await db.WireHarness.findByPk(harness.id);
      expect(updated.releaseState).toBe('review');
    });

    it('rejects harness from review', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Reject Harness', releaseState: 'review' });

      const res = await auth.post(`/api/parts/harness/${harness.id}/reject`)
        .send({ notes: 'Needs rework' });
      expect(res.status).toBe(200);
      const updated = await db.WireHarness.findByPk(harness.id);
      expect(updated.releaseState).toBe('draft');
    });

    it('releases harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Release Harness', releaseState: 'review' });

      const res = await auth.post(`/api/parts/harness/${harness.id}/release`);
      expect(res.status).toBe(200);
      const updated = await db.WireHarness.findByPk(harness.id);
      expect(updated.releaseState).toBe('released');
      expect(updated.releasedAt).toBeDefined();
    });

    it('gets revision history', async () => {
      const auth = await authenticatedRequest();
      // Create via API to get auto-generated history
      const createRes = await auth.post('/api/parts/harness')
        .send({ name: 'History Harness 2', revision: 'A', harnessData: {} });

      const res = await auth.get(`/api/parts/harness/${createRes.body.id}/history`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('gets all revisions', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Rev Harness', revision: 'A' });

      const res = await auth.get(`/api/parts/harness/${harness.id}/revisions`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Sub-Harness', () => {
    it('gets sub-harness data for multiple IDs', async () => {
      const auth = await authenticatedRequest();
      const h1 = await createTestHarness({ name: 'Sub H1' });
      const h2 = await createTestHarness({ name: 'Sub H2' });

      const res = await auth.get(`/api/parts/harness/sub-harness-data?ids=${h1.id},${h2.id}`);
      expect(res.status).toBe(200);
    });

    it('gets parent harnesses', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Child Harness' });

      const res = await auth.get(`/api/parts/harness/${harness.id}/parents`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/parts/harness/validate', () => {
    it('validates harness data', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/harness/validate')
        .send({
          harnessData: { connectors: [], cables: [], connections: [] },
        });
      expect(res.status).toBe(200);
    });
  });
});
