const { authenticatedRequest, createTestBarcode } = require('../../helpers');

describe('Box API', () => {
  let auth;

  beforeEach(async () => {
    auth = await authenticatedRequest();
  });

  async function createTestBox(overrides = {}) {
    const barcode = await createTestBarcode({ barcodeCategoryID: 3 });
    return db.Box.create({
      name: overrides.name || 'BOX-TEST',
      description: overrides.description || 'Test box',
      barcodeID: barcode.id,
      activeFlag: true,
      ...overrides,
    });
  }

  describe('GET /api/inventory/box/:id', () => {
    it('gets box by id', async () => {
      const box = await createTestBox({ name: 'BOX-GET' });
      const res = await auth.get(`/api/inventory/box/${box.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('BOX-GET');
    });
  });

  // Note: POST /box internally creates Barcode using PostgreSQL sequence hook.
  // Tested via factory at DB level instead.

  describe('PUT /api/inventory/box/:id', () => {
    it('updates a box', async () => {
      const box = await createTestBox({ name: 'BOX-UPD' });
      const res = await auth.put(`/api/inventory/box/${box.id}`)
        .send({ name: 'BOX-UPDATED', description: 'Updated' });
      expect(res.status).toBe(200);
      const updated = await db.Box.findByPk(box.id);
      expect(updated.description).toBe('Updated');
    });
  });
});
