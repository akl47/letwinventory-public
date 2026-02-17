const { authenticatedRequest, createTestFile } = require('../helpers');
const request = require('supertest');

const getApp = () => require('../app');

describe('Files API', () => {
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
});
