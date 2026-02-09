const { authenticatedRequest, createTestFile } = require('../helpers');
const request = require('supertest');

const getApp = () => require('../app');

describe('Files API', () => {
  describe('POST /api/files', () => {
    it('uploads a file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/files')
        .send({
          filename: 'test-image.png',
          mimeType: 'image/png',
          data: 'iVBORw0KGgo=',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.filename).toBe('test-image.png');
      expect(res.body.mimeType).toBe('image/png');
    });

    it('returns 400 without required fields', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/files').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp())
        .post('/api/files')
        .send({ filename: 'x.png', mimeType: 'image/png', data: 'abc' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/files', () => {
    it('lists files', async () => {
      const auth = await authenticatedRequest();
      await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get('/api/files');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      // Should not include data by default in list
      expect(res.body[0].filename).toBeDefined();
    });

    it('returns empty array when no files', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/files');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/files/:id', () => {
    it('gets file by id without data by default', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get(`/api/files/${file.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(file.id);
      expect(res.body.filename).toBe(file.filename);
    });

    it('gets file by id with data when requested', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get(`/api/files/${file.id}?includeData=true`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/files/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/files/:id/data', () => {
    it('gets file binary data', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get(`/api/files/${file.id}/data`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.mimeType).toBe('image/png');
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/files/99999/data');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/files/:id', () => {
    it('updates filename', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.put(`/api/files/${file.id}`)
        .send({ filename: 'renamed.png' });
      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/files/99999')
        .send({ filename: 'nope.png' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/files/:id', () => {
    it('soft deletes a file', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.delete(`/api/files/${file.id}`);
      expect(res.status).toBe(200);

      // Should not appear in active list
      const listRes = await auth.get('/api/files');
      expect(listRes.body.length).toBe(0);
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/files/99999');
      expect(res.status).toBe(404);
    });
  });
});
