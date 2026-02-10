const { authenticatedRequest, createTestLocation } = require('../../helpers');

describe('Location API', () => {
  // Note: hierarchy endpoint uses raw PostgreSQL recursive CTE query, skipped for SQLite
  describe('GET /api/inventory/location/higherarchy', () => {
    it.skip('returns location hierarchy (requires PostgreSQL)', async () => {
      const auth = await authenticatedRequest();
      await createTestLocation({ name: 'LOC-H1' });
      const res = await auth.get('/api/inventory/location/higherarchy');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/inventory/location/:id', () => {
    it('gets location by id', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-GET' });
      const res = await auth.get(`/api/inventory/location/${loc.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('LOC-GET');
    });
  });

  // Note: POST /location internally creates Barcode using PostgreSQL sequence hook.
  // Tested via factory at DB level instead.

  describe('PUT /api/inventory/location/:id', () => {
    it('updates a location', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-UPD' });
      const res = await auth.put(`/api/inventory/location/${loc.id}`)
        .send({ name: 'LOC-UPDATED', description: 'Updated' });
      expect(res.status).toBe(200);
      const updated = await db.Location.findByPk(loc.id);
      expect(updated.description).toBe('Updated');
    });
  });
});
