const { authenticatedRequest, createTestWire, createTestPart } = require('../../helpers');

describe('Wire API', () => {
  describe('GET /api/parts/wire', () => {
    it('lists all wires', async () => {
      const auth = await authenticatedRequest();
      await createTestWire({ label: 'W1', color: 'Red' });
      await createTestWire({ label: 'W2', color: 'Black' });

      const res = await auth.get('/api/parts/wire');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/parts/wire/by-part/:partId', () => {
    it('gets wire by part id', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'WirePart' });
      await createTestWire({ label: 'W-Part', color: 'Blue', partID: part.id });

      const res = await auth.get(`/api/parts/wire/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('W-Part');
    });
  });

  describe('GET /api/parts/wire/:id', () => {
    it('gets wire by id', async () => {
      const auth = await authenticatedRequest();
      const wire = await createTestWire({ label: 'W-Get', color: 'Green' });
      const res = await auth.get(`/api/parts/wire/${wire.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('W-Get');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/wire/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/wire', () => {
    it('creates a wire', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/wire')
        .send({ label: 'W-NEW', color: 'Yellow', gaugeAWG: '22' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.label).toBe('W-NEW');
    });
  });

  describe('PUT /api/parts/wire/:id', () => {
    it('updates a wire', async () => {
      const auth = await authenticatedRequest();
      const wire = await createTestWire({ label: 'W-UPD', color: 'White' });
      const res = await auth.put(`/api/parts/wire/${wire.id}`)
        .send({ color: 'Orange' });
      expect(res.status).toBe(200);
      const updated = await db.Wire.findByPk(wire.id);
      expect(updated.color).toBe('Orange');
    });
  });

  describe('DELETE /api/parts/wire/:id', () => {
    it('soft deletes a wire', async () => {
      const auth = await authenticatedRequest();
      const wire = await createTestWire({ label: 'W-DEL', color: 'Purple' });
      const res = await auth.delete(`/api/parts/wire/${wire.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Wire.findByPk(wire.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
