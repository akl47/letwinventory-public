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

describe('Requirement History (REQ-DES-008 — REQ-DES-010)', () => {
  describe('History on create (REQ-DES-009)', () => {
    it('records history entry when requirement is created', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      const req = await createTestRequirement(auth, project.id, {
        description: 'New req',
        rationale: 'Because',
      });

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].changeType).toBe('created');
      expect(res.body[0].changedByUserID).toBe(auth.user.id);
      expect(res.body[0].changes.description).toEqual({ from: null, to: 'New req' });
      expect(res.body[0].changes.rationale).toEqual({ from: null, to: 'Because' });
      expect(res.body[0].changes.projectID).toEqual({ from: null, to: project.id });
    });
  });

  describe('History on update (REQ-DES-009)', () => {
    it('records field-level diffs on update', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'Original' });

      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Updated', rationale: 'New rationale' });

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.status).toBe(200);
      // Should have 2 entries: created + updated (DESC order)
      expect(res.body.length).toBe(2);
      const updateEntry = res.body[0]; // most recent first
      expect(updateEntry.changeType).toBe('updated');
      expect(updateEntry.changes.description).toEqual({ from: 'Original', to: 'Updated' });
      expect(updateEntry.changes.rationale).toEqual({ from: 'Test rationale', to: 'New rationale' });
    });

    it('does not record history when nothing changed', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'Same' });

      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Same' });

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.body.length).toBe(1); // Only the 'created' entry
    });

    it('supports changeNotes on update', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'V1' });

      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'V2', changeNotes: 'Updated per review feedback' });

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      const updateEntry = res.body[0];
      expect(updateEntry.changeNotes).toBe('Updated per review feedback');
    });
  });

  describe('History on approve (REQ-DES-009)', () => {
    it('records history when requirement is approved', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      await auth.put(`/api/design/requirement/${req.id}/approve`);

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      const approveEntry = res.body[0];
      expect(approveEntry.changeType).toBe('approved');
      expect(approveEntry.changes.approved).toEqual({ from: false, to: true });
      expect(approveEntry.changes.approvedByUserID).toEqual(expect.objectContaining({ from: null, to: auth.user.id }));
    });
  });

  describe('History on unapprove (REQ-DES-009)', () => {
    it('records history when requirement is unapproved', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      await auth.put(`/api/design/requirement/${req.id}/approve`);
      await auth.put(`/api/design/requirement/${req.id}/unapprove`);

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      const unapproveEntry = res.body[0];
      expect(unapproveEntry.changeType).toBe('unapproved');
      expect(unapproveEntry.changes.approved).toEqual({ from: true, to: false });
      expect(unapproveEntry.changes.approvedByUserID).toEqual(expect.objectContaining({ from: auth.user.id, to: null }));
    });
  });

  describe('History on delete (REQ-DES-009)', () => {
    it('records history when requirement is deleted', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id);

      await auth.delete(`/api/design/requirement/${req.id}`);

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      const deleteEntry = res.body[0];
      expect(deleteEntry.changeType).toBe('deleted');
      expect(deleteEntry.changes.activeFlag).toEqual({ from: true, to: false });
    });
  });

  describe('GET /api/design/requirement/:id/history (REQ-DES-010)', () => {
    it('returns entries ordered by createdAt DESC', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'V1' });

      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'V2' });

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      // First entry should be most recent (updated)
      expect(res.body[0].changeType).toBe('updated');
      expect(res.body[1].changeType).toBe('created');
    });

    it('includes changedBy user association', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      await createTestRequirement(auth, project.id);

      const res = await auth.get(`/api/design/requirement/${project.id}/history`);
      // Get history from the actual requirement
      const reqRes = await auth.get('/api/design/requirement');
      const reqId = reqRes.body[0].id;
      const histRes = await auth.get(`/api/design/requirement/${reqId}/history`);
      expect(histRes.status).toBe(200);
      expect(histRes.body[0].changedBy).toBeDefined();
      expect(histRes.body[0].changedBy.displayName).toBe('Test User');
      expect(histRes.body[0].changedBy.email).toBeDefined();
    });

    it('returns 404 for nonexistent requirement', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/design/requirement/99999/history');
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .get('/api/design/requirement/1/history');
      expect(res.status).toBe(401);
    });
  });

  describe('Auto-unapprove on edit', () => {
    it('automatically unapproves when an approved requirement is edited', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'Original' });

      // Approve first
      await auth.put(`/api/design/requirement/${req.id}/approve`);

      // Edit — should auto-unapprove
      const updateRes = await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Changed' });
      expect(updateRes.body.approved).toBe(false);
      expect(updateRes.body.approvedByUserID).toBeNull();

      // History should show: unapproved, updated, approved, created (DESC)
      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.body.length).toBe(4);
      expect(res.body[0].changeType).toBe('unapproved');
      expect(res.body[1].changeType).toBe('updated');
      expect(res.body[2].changeType).toBe('approved');
      expect(res.body[3].changeType).toBe('created');
    });

    it('does not unapprove when update has no actual changes', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);
      const req = await createTestRequirement(auth, project.id, { description: 'Same' });

      await auth.put(`/api/design/requirement/${req.id}/approve`);
      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Same' });

      const fetched = await auth.get(`/api/design/requirement/${req.id}`);
      expect(fetched.body.approved).toBe(true);
    });
  });

  describe('Full lifecycle audit trail (QMS)', () => {
    it('records complete lifecycle: create → update → approve → unapprove → delete', async () => {
      const auth = await authenticatedRequest();
      const project = await createTestProject(auth.user);

      // Create
      const req = await createTestRequirement(auth, project.id, { description: 'Lifecycle test' });

      // Update (not yet approved, so no auto-unapprove)
      await auth.put(`/api/design/requirement/${req.id}`)
        .send({ description: 'Lifecycle test v2' });

      // Approve
      await auth.put(`/api/design/requirement/${req.id}/approve`);

      // Unapprove
      await auth.put(`/api/design/requirement/${req.id}/unapprove`);

      // Delete
      await auth.delete(`/api/design/requirement/${req.id}`);

      const res = await auth.get(`/api/design/requirement/${req.id}/history`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(5);

      // DESC order: deleted, unapproved, approved, updated, created
      expect(res.body[0].changeType).toBe('deleted');
      expect(res.body[1].changeType).toBe('unapproved');
      expect(res.body[2].changeType).toBe('approved');
      expect(res.body[3].changeType).toBe('updated');
      expect(res.body[4].changeType).toBe('created');

      // Every entry has a user and timestamp
      for (const entry of res.body) {
        expect(entry.changedByUserID).toBe(auth.user.id);
        expect(entry.createdAt).toBeDefined();
      }
    });
  });
});
