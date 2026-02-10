const { authenticatedRequest, createTestConnector, createTestPart } = require('../../helpers');

describe('Connector API', () => {
  describe('GET /api/parts/connector', () => {
    it('lists all connectors', async () => {
      const auth = await authenticatedRequest();
      await createTestConnector({ label: 'J1' });
      await createTestConnector({ label: 'J2' });

      const res = await auth.get('/api/parts/connector');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('excludes inactive connectors', async () => {
      const auth = await authenticatedRequest();
      await createTestConnector({ label: 'Active' });
      await createTestConnector({ label: 'Inactive', activeFlag: false });

      const res = await auth.get('/api/parts/connector');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });
  });

  describe('GET /api/parts/connector/pin-types', () => {
    it('lists pin types', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/connector/pin-types');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/parts/connector/by-part/:partId', () => {
    it('gets connector by part id', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'ConnPart' });
      await createTestConnector({ label: 'J-Part', partID: part.id });

      const res = await auth.get(`/api/parts/connector/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('J-Part');
    });
  });

  describe('GET /api/parts/connector/:id', () => {
    it('gets connector by id', async () => {
      const auth = await authenticatedRequest();
      const conn = await createTestConnector({ label: 'J-Get' });
      const res = await auth.get(`/api/parts/connector/${conn.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('J-Get');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/connector/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/connector', () => {
    it('creates a connector', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/connector')
        .send({
          label: 'J-NEW',
          type: 'female',
          pinCount: 2,
          pins: [{ id: 1, number: 1, label: 'Pin 1' }, { id: 2, number: 2, label: 'Pin 2' }],
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.label).toBe('J-NEW');
      expect(res.body.type).toBe('female');
    });
  });

  describe('PUT /api/parts/connector/:id', () => {
    it('updates a connector', async () => {
      const auth = await authenticatedRequest();
      const conn = await createTestConnector({ label: 'J-UPD' });
      const res = await auth.put(`/api/parts/connector/${conn.id}`)
        .send({ label: 'J-UPDATED', pinCount: 8 });
      expect(res.status).toBe(200);
      const updated = await db.ElectricalConnector.findByPk(conn.id);
      expect(updated.label).toBe('J-UPDATED');
    });
  });

  describe('DELETE /api/parts/connector/:id', () => {
    it('soft deletes a connector', async () => {
      const auth = await authenticatedRequest();
      const conn = await createTestConnector({ label: 'J-DEL' });
      const res = await auth.delete(`/api/parts/connector/${conn.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.ElectricalConnector.findByPk(conn.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
