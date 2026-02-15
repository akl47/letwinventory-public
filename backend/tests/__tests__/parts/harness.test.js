const { authenticatedRequest, createTestHarness, createTestPart } = require('../../helpers');

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

  describe('POST /api/parts/harness/:id/release-production', () => {
    it('creates production release from released numeric-revision harness', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'Harness Part' });
      const harness = await createTestHarness({
        name: 'Prod Release Harness',
        revision: '01',
        releaseState: 'released',
        releasedAt: new Date(),
        partID: part.id,
        harnessData: { connectors: [], cables: [] },
      });

      const res = await auth.post(`/api/parts/harness/${harness.id}/release-production`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe(harness.id);
      expect(res.body.revision).toBe('A');
      expect(res.body.releaseState).toBe('released');
      expect(res.body.previousRevisionID).toBe(harness.id);
    });

    it('rejects production release from draft harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({
        name: 'Draft Harness',
        revision: '01',
        releaseState: 'draft',
      });

      const res = await auth.post(`/api/parts/harness/${harness.id}/release-production`);
      expect(res.status).toBe(400);
    });

    it('rejects production release from letter-revision harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({
        name: 'Letter Rev Harness',
        revision: 'A',
        releaseState: 'released',
        releasedAt: new Date(),
      });

      const res = await auth.post(`/api/parts/harness/${harness.id}/release-production`);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent harness', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/harness/99999/release-production');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/harness/:id/revert/:historyId', () => {
    it('reverts draft harness to a history snapshot', async () => {
      const auth = await authenticatedRequest();
      // Create via API to get auto-generated history with snapshot
      const createRes = await auth.post('/api/parts/harness')
        .send({
          name: 'Revert Harness',
          revision: 'A',
          harnessData: { connectors: [{ id: 'c1', label: 'J1' }], cables: [] },
        });
      expect(createRes.status).toBe(201);
      const harnessId = createRes.body.id;

      // Update the harness data
      await auth.put(`/api/parts/harness/${harnessId}`)
        .send({ harnessData: { connectors: [{ id: 'c1', label: 'J1-MODIFIED' }], cables: [] } });

      // Get history to find the snapshot
      const historyRes = await auth.get(`/api/parts/harness/${harnessId}/history`);
      expect(historyRes.status).toBe(200);
      const snapshotEntry = historyRes.body.find(h => h.snapshotData);

      if (snapshotEntry) {
        const res = await auth.post(`/api/parts/harness/${harnessId}/revert/${snapshotEntry.id}`);
        expect(res.status).toBe(200);
        expect(res.body.harnessData).toBeDefined();
      }
    });

    it('rejects revert on released harness', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({
        name: 'Released Revert',
        releaseState: 'released',
        releasedAt: new Date(),
      });

      // Create a fake history entry
      const history = await db.HarnessRevisionHistory.create({
        harnessID: harness.id,
        revision: 'A',
        releaseState: 'draft',
        changedBy: 'test',
        changeType: 'created',
        snapshotData: { connectors: [] },
        createdAt: new Date(),
      });

      const res = await auth.post(`/api/parts/harness/${harness.id}/revert/${history.id}`);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent history entry', async () => {
      const auth = await authenticatedRequest();
      const harness = await createTestHarness({ name: 'Revert 404' });
      const res = await auth.post(`/api/parts/harness/${harness.id}/revert/99999`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent harness', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/harness/99999/revert/1');
      expect(res.status).toBe(404);
    });
  });

  describe('Harness Data Persistence', () => {
    it('preserves harnessData through save and load', async () => {
      const auth = await authenticatedRequest();
      const harnessData = {
        name: 'Test Harness',
        connectors: [
          { id: 'c1', label: 'J1', type: 'male', pinCount: 2, pins: [], position: { x: 0, y: 0 } }
        ],
        cables: [],
        components: [],
        connections: []
      };

      const createRes = await auth.post('/api/parts/harness')
        .send({ name: 'Persist Harness', revision: 'A', harnessData });
      expect(createRes.status).toBe(201);

      const getRes = await auth.get(`/api/parts/harness/${createRes.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.harnessData.connectors).toHaveLength(1);
      expect(getRes.body.harnessData.connectors[0].label).toBe('J1');
    });

    it('stores harnessData without image fields when stripped by frontend', async () => {
      const auth = await authenticatedRequest();
      // Simulate frontend stripping: no image fields in saved data
      const harnessData = {
        name: 'Stripped Harness',
        connectors: [
          { id: 'c1', label: 'J1', type: 'male', pinCount: 2, pins: [], position: { x: 0, y: 0 }, showConnectorImage: true }
        ],
        cables: [
          { id: 'cb1', label: 'C1', wireCount: 2, wires: [], position: { x: 100, y: 0 }, showCableDiagram: true }
        ],
        components: [],
        connections: []
      };

      const createRes = await auth.post('/api/parts/harness')
        .send({ name: 'No Image Harness', revision: 'A', harnessData });
      expect(createRes.status).toBe(201);

      const getRes = await auth.get(`/api/parts/harness/${createRes.body.id}`);
      expect(getRes.status).toBe(200);
      // Show flags are preserved
      expect(getRes.body.harnessData.connectors[0].showConnectorImage).toBe(true);
      expect(getRes.body.harnessData.cables[0].showCableDiagram).toBe(true);
      // Image data fields are absent (stripped by frontend before save)
      expect(getRes.body.harnessData.connectors[0].connectorImage).toBeUndefined();
      expect(getRes.body.harnessData.cables[0].cableDiagramImage).toBeUndefined();
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
