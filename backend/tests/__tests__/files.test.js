const { authenticatedRequest, createTestFile } = require('../helpers');
const request = require('supertest');

const getApp = () => require('../app');

describe('Files API', () => {
  describe('GET /api/files/:id', () => {
    it('returns file metadata without binary data', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get(`/api/files/${file.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(file.id);
      expect(res.body.filename).toBe(file.filename);
      expect(res.body.mimeType).toBe(file.mimeType);
      expect(res.body.data).toBeUndefined();
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/files/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/files/:id/data', () => {
    it('streams binary file content with the correct Content-Type', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ uploadedBy: auth.user.id });
      const res = await auth.get(`/api/files/${file.id}/data`).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('returns 404 for nonexistent file', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/files/99999/data');
      expect(res.status).toBe(404);
    });
  });
});
