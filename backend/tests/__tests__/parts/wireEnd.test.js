const { authenticatedRequest, createTestWireEnd } = require('../../helpers');

describe('WireEnd API', () => {
  describe('GET /api/parts/wire-end', () => {
    it('lists all wire ends', async () => {
      const auth = await authenticatedRequest();
      await createTestWireEnd({ code: 'f-pin', name: 'Female Pin' });
      await createTestWireEnd({ code: 'm-pin', name: 'Male Pin' });

      const res = await auth.get('/api/parts/wire-end');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('excludes inactive wire ends', async () => {
      const auth = await authenticatedRequest();
      await createTestWireEnd({ code: 'active-end', name: 'Active' });
      await createTestWireEnd({ code: 'inactive-end', name: 'Inactive', activeFlag: false });

      const res = await auth.get('/api/parts/wire-end');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });
  });

  describe('GET /api/parts/wire-end/by-code/:code', () => {
    it('gets wire end by code', async () => {
      const auth = await authenticatedRequest();
      await createTestWireEnd({ code: 'ring-end', name: 'Ring Terminal' });

      const res = await auth.get('/api/parts/wire-end/by-code/ring-end');
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('ring-end');
      expect(res.body.name).toBe('Ring Terminal');
    });

    it('returns null for nonexistent code', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/wire-end/by-code/nonexistent');
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe('GET /api/parts/wire-end/:id', () => {
    it('gets wire end by id', async () => {
      const auth = await authenticatedRequest();
      const we = await createTestWireEnd({ code: 'fork-end', name: 'Fork' });
      const res = await auth.get(`/api/parts/wire-end/${we.id}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('fork-end');
    });

    it('returns 404 for nonexistent id', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/wire-end/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/wire-end', () => {
    it('creates a wire end', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/wire-end')
        .send({ code: 'new-end', name: 'New End Type', description: 'A new end' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.code).toBe('new-end');
    });
  });

  describe('PUT /api/parts/wire-end/:id', () => {
    it('updates a wire end', async () => {
      const auth = await authenticatedRequest();
      const we = await createTestWireEnd({ code: 'upd-end', name: 'Original' });
      const res = await auth.put(`/api/parts/wire-end/${we.id}`)
        .send({ name: 'Updated Name' });
      expect(res.status).toBe(200);
      const updated = await db.WireEnd.findByPk(we.id);
      expect(updated.name).toBe('Updated Name');
    });
  });

  describe('DELETE /api/parts/wire-end/:id', () => {
    it('soft deletes a wire end', async () => {
      const auth = await authenticatedRequest();
      const we = await createTestWireEnd({ code: 'del-end', name: 'ToDelete' });
      const res = await auth.delete(`/api/parts/wire-end/${we.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.WireEnd.findByPk(we.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
