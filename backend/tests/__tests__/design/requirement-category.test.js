const { authenticatedRequest } = require('../../helpers');
const request = require('supertest');

const getApp = () => require('../../app');

describe('Requirement Categories API', () => {
  describe('POST /api/design/requirement-category', () => {
    it('creates a category', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/design/requirement-category')
        .send({ name: 'Functional', description: 'Functional requirements' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Functional');
      expect(res.body.description).toBe('Functional requirements');
      expect(res.body.activeFlag).toBe(true);
    });

    it('rejects duplicate name', async () => {
      const auth = await authenticatedRequest();
      await auth.post('/api/design/requirement-category')
        .send({ name: 'Safety' });
      const res = await auth.post('/api/design/requirement-category')
        .send({ name: 'Safety' });
      expect(res.status).toBe(400);
    });

    it('rejects missing name', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/design/requirement-category')
        .send({ description: 'No name' });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .post('/api/design/requirement-category')
        .send({ name: 'Unauth' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/design/requirement-category', () => {
    it('lists active categories', async () => {
      const auth = await authenticatedRequest();
      await auth.post('/api/design/requirement-category')
        .send({ name: 'Cat-A' });
      await auth.post('/api/design/requirement-category')
        .send({ name: 'Cat-B' });

      const res = await auth.get('/api/design/requirement-category');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('excludes inactive categories', async () => {
      const auth = await authenticatedRequest();
      const created = await auth.post('/api/design/requirement-category')
        .send({ name: 'ToDeactivate' });
      await auth.delete(`/api/design/requirement-category/${created.body.id}`);

      const res = await auth.get('/api/design/requirement-category');
      expect(res.status).toBe(200);
      expect(res.body.find(c => c.name === 'ToDeactivate')).toBeUndefined();
    });
  });

  describe('PUT /api/design/requirement-category/:id', () => {
    it('updates a category', async () => {
      const auth = await authenticatedRequest();
      const created = await auth.post('/api/design/requirement-category')
        .send({ name: 'Old Name' });

      const res = await auth.put(`/api/design/requirement-category/${created.body.id}`)
        .send({ name: 'New Name', description: 'Updated' });
      expect(res.status).toBe(200);

      const fetched = await auth.get('/api/design/requirement-category');
      const updated = fetched.body.find(c => c.id === created.body.id);
      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated');
    });

    it('returns 404 for nonexistent category', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/design/requirement-category/99999')
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/design/requirement-category/:id', () => {
    it('soft deletes a category', async () => {
      const auth = await authenticatedRequest();
      const created = await auth.post('/api/design/requirement-category')
        .send({ name: 'ToDelete' });

      const res = await auth.delete(`/api/design/requirement-category/${created.body.id}`);
      expect(res.status).toBe(200);

      const deleted = await db.RequirementCategory.findByPk(created.body.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent category', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/design/requirement-category/99999');
      expect(res.status).toBe(404);
    });
  });
});
