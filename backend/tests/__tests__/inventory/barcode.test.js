const { authenticatedRequest, createTestBarcode, createTestLocation } = require('../../helpers');

describe('Barcode API', () => {
  describe('GET /api/inventory/barcode', () => {
    it('lists all barcodes', async () => {
      const auth = await authenticatedRequest();
      await createTestBarcode({ barcodeCategoryID: 1 });
      await createTestBarcode({ barcodeCategoryID: 2 });
      const res = await auth.get('/api/inventory/barcode');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/inventory/barcode/category', () => {
    it('lists barcode categories', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcode/category');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('GET /api/inventory/barcode/locations', () => {
    it('lists location barcodes', async () => {
      const auth = await authenticatedRequest();
      await createTestLocation({ name: 'LOC-BC' });
      const res = await auth.get('/api/inventory/barcode/locations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/inventory/barcode/lookup/:barcode', () => {
    it('looks up barcode by string', async () => {
      const auth = await authenticatedRequest();
      const barcode = await createTestBarcode({ barcodeCategoryID: 1 });
      const res = await auth.get(`/api/inventory/barcode/lookup/${barcode.barcode}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(barcode.id);
    });

    it('returns 404 for nonexistent barcode', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcode/lookup/NONEXIST-999');
      expect(res.status).toBe(404);
    });
  });

  // Note: getAllTags uses raw PostgreSQL UNION query with NULL::INTEGER casts, skipped for SQLite
  describe('GET /api/inventory/barcode/tag/', () => {
    it.skip('lists all tags (requires PostgreSQL)', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcode/tag/');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // Note: moveBarcodeByID uses raw PostgreSQL SQL with RETURNING * and NOW(), skipped for SQLite
  describe('POST /api/inventory/barcode/move/:id', () => {
    it.skip('moves a barcode to new parent (requires PostgreSQL)', async () => {
      const auth = await authenticatedRequest();
      const child = await createTestBarcode({ barcodeCategoryID: 1 });
      const parent = await createTestBarcode({ barcodeCategoryID: 2 });

      const res = await auth.post(`/api/inventory/barcode/move/${child.id}`)
        .send({ parentBarcodeID: parent.id });
      expect(res.status).toBe(200);

      const moved = await db.Barcode.findByPk(child.id);
      expect(moved.parentBarcodeID).toBe(parent.id);
    });
  });

  describe('DELETE /api/inventory/barcode/:id', () => {
    it('deletes a barcode', async () => {
      const auth = await authenticatedRequest();
      const barcode = await createTestBarcode({ barcodeCategoryID: 1 });
      const res = await auth.delete(`/api/inventory/barcode/${barcode.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Barcode.findByPk(barcode.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
