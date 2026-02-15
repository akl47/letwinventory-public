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

  describe('GET /api/inventory/barcode/display/:id', () => {
    it('returns ZPL string for a location barcode', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-ZPL' });
      const location = await db.Location.findByPk(loc.id);
      const res = await auth.get(`/api/inventory/barcode/display/${location.barcodeID}`);
      expect(res.status).toBe(200);
      expect(typeof res.text).toBe('string');
      expect(res.text).toContain('^XA'); // ZPL start command
    });

    it('returns 404 for nonexistent barcode', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcode/display/99999');
      expect(res.status).toBe(404);
    });

    it('accepts labelSize query param', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-SIZE' });
      const location = await db.Location.findByPk(loc.id);
      const res = await auth.get(`/api/inventory/barcode/display/${location.barcodeID}?labelSize=1.5x1`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('^XA');
    });
  });

  describe('GET /api/inventory/barcode/tag/:id', () => {
    it('returns tag for a location barcode', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-TAG' });
      const location = await db.Location.findByPk(loc.id);
      const res = await auth.get(`/api/inventory/barcode/tag/${location.barcodeID}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('Location');
      expect(res.body.name).toBe('LOC-TAG');
      expect(res.body.barcodeID).toBe(location.barcodeID);
    });

    it('returns 404 for nonexistent barcode', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcode/tag/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/inventory/barcode/tag/chain/:id', () => {
    it('returns tag chain for a barcode with parent', async () => {
      const auth = await authenticatedRequest();
      const parentLoc = await createTestLocation({ name: 'LOC-PARENT' });
      const parentLocation = await db.Location.findByPk(parentLoc.id);
      const childBarcode = await createTestBarcode({
        barcodeCategoryID: 3,
        parentBarcodeID: parentLocation.barcodeID,
      });
      await db.Box.create({
        name: 'BOX-CHILD',
        barcodeID: childBarcode.id,
        activeFlag: true,
      });

      const res = await auth.get(`/api/inventory/barcode/tag/chain/${childBarcode.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].type).toBe('Box');
      expect(res.body[1].type).toBe('Location');
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

  describe('POST /api/inventory/barcode/print/:id', () => {
    it.skip('prints barcode to label printer (requires network access)', async () => {
      const auth = await authenticatedRequest();
      const loc = await createTestLocation({ name: 'LOC-PRINT' });
      const location = await db.Location.findByPk(loc.id);
      const res = await auth.post(`/api/inventory/barcode/print/${location.barcodeID}`)
        .send({ labelSize: '3x1' });
      expect(res.status).toBe(200);
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
