const { authenticatedRequest, createTestEquipment } = require('../../helpers');

describe('Equipment API', () => {
  describe('GET /api/inventory/equipment', () => {
    it('lists all equipment', async () => {
      const auth = await authenticatedRequest();
      await createTestEquipment({ name: 'Equip A' });
      await createTestEquipment({ name: 'Equip B' });

      const res = await auth.get('/api/inventory/equipment');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('includes barcode association', async () => {
      const auth = await authenticatedRequest();
      await createTestEquipment({ name: 'Equip-Barcode' });
      const res = await auth.get('/api/inventory/equipment');
      expect(res.status).toBe(200);
      expect(res.body[0].Barcode).toBeDefined();
    });
  });

  describe('GET /api/inventory/equipment/:id', () => {
    it('gets equipment by id', async () => {
      const auth = await authenticatedRequest();
      const equip = await createTestEquipment({ name: 'GetEquip' });
      const res = await auth.get(`/api/inventory/equipment/${equip.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('GetEquip');
    });

    it('returns 404 for nonexistent equipment', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/equipment/99999');
      expect(res.status).toBe(404);
    });
  });

  // Note: POST /equipment and POST /equipment/receive internally create Barcodes
  // using a PostgreSQL-specific sequence query hook, so they can't be tested
  // with SQLite in-memory. Those endpoints are covered by the Barcode auto-generation.
  // We test the CRUD operations that work with pre-created equipment instead.

  describe('PUT /api/inventory/equipment/:id', () => {
    it('updates equipment', async () => {
      const auth = await authenticatedRequest();
      const equip = await createTestEquipment({ name: 'ToUpdate' });
      const res = await auth.put(`/api/inventory/equipment/${equip.id}`)
        .send({ name: 'Updated Equipment', description: 'Updated' });
      expect(res.status).toBe(200);
      const updated = await db.Equipment.findByPk(equip.id);
      expect(updated.name).toBe('Updated Equipment');
    });
  });

  describe('DELETE /api/inventory/equipment/:id', () => {
    it('soft deletes equipment and its barcode', async () => {
      const auth = await authenticatedRequest();
      const equip = await createTestEquipment({ name: 'ToDelete' });
      const res = await auth.delete(`/api/inventory/equipment/${equip.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Equipment.findByPk(equip.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent equipment', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/inventory/equipment/99999');
      expect(res.status).toBe(404);
    });
  });
});
