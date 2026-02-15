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
  // The barcode auto-generation requires a PostgreSQL sequence, so skipped for SQLite.
  describe('POST /api/inventory/box', () => {
    it.skip('creates a box with auto-generated barcode (requires PostgreSQL)', async () => {
      const parentBarcode = await createTestBarcode({ barcodeCategoryID: 2 });
      const res = await auth.post('/api/inventory/box')
        .send({
          name: 'BOX-NEW',
          description: 'New test box',
          parentBarcodeID: parentBarcode.id,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('BOX-NEW');
      expect(res.body.barcodeID).toBeDefined();
    });
  });

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
