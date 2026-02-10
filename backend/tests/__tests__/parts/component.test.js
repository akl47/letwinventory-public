const { authenticatedRequest, createTestComponent, createTestPart } = require('../../helpers');

describe('Component API', () => {
  describe('GET /api/parts/component', () => {
    it('lists all components', async () => {
      const auth = await authenticatedRequest();
      await createTestComponent({ label: 'U1' });
      await createTestComponent({ label: 'R1' });

      const res = await auth.get('/api/parts/component');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/parts/component/by-part/:partId', () => {
    it('gets component by part id', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'CompPart' });
      await createTestComponent({ label: 'U-Part', partID: part.id });

      const res = await auth.get(`/api/parts/component/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('U-Part');
    });
  });

  describe('GET /api/parts/component/:id', () => {
    it('gets component by id', async () => {
      const auth = await authenticatedRequest();
      const comp = await createTestComponent({ label: 'U-Get' });
      const res = await auth.get(`/api/parts/component/${comp.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('U-Get');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/component/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/component', () => {
    it('creates a component', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/component')
        .send({
          label: 'U-NEW',
          pinCount: 4,
          pins: [
            { id: 1, name: 'Group1', pins: [
              { id: 1, number: 1, label: 'VCC' },
              { id: 2, number: 2, label: 'GND' },
            ]},
          ],
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.label).toBe('U-NEW');
    });
  });

  describe('PUT /api/parts/component/:id', () => {
    it('updates a component', async () => {
      const auth = await authenticatedRequest();
      const comp = await createTestComponent({ label: 'U-UPD' });
      const res = await auth.put(`/api/parts/component/${comp.id}`)
        .send({ pinCount: 8 });
      expect(res.status).toBe(200);
      const updated = await db.ElectricalComponent.findByPk(comp.id);
      expect(updated.pinCount).toBe(8);
    });
  });

  describe('DELETE /api/parts/component/:id', () => {
    it('soft deletes a component', async () => {
      const auth = await authenticatedRequest();
      const comp = await createTestComponent({ label: 'U-DEL' });
      const res = await auth.delete(`/api/parts/component/${comp.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.ElectricalComponent.findByPk(comp.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
