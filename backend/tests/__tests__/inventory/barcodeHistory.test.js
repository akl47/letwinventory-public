const { authenticatedRequest, createTestBarcode } = require('../../helpers');

describe('BarcodeHistory API', () => {
  describe('GET /api/inventory/barcodehistory', () => {
    it('lists all barcode history', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcodehistory');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/inventory/barcodehistory/actiontypes', () => {
    it('lists action types', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/barcodehistory/actiontypes');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(5);
      expect(res.body.find(a => a.code === 'CREATED')).toBeDefined();
      expect(res.body.find(a => a.code === 'MOVED')).toBeDefined();
    });
  });

  describe('GET /api/inventory/barcodehistory/barcode/:barcodeId', () => {
    it('gets history for a barcode', async () => {
      const auth = await authenticatedRequest();
      const barcode = await createTestBarcode({ barcodeCategoryID: 1 });

      // Create a history entry
      await db.BarcodeHistory.create({
        barcodeID: barcode.id,
        userID: auth.user.id,
        actionID: 1,
      });

      const res = await auth.get(`/api/inventory/barcodehistory/barcode/${barcode.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('returns empty array for barcode with no history', async () => {
      const auth = await authenticatedRequest();
      const barcode = await createTestBarcode({ barcodeCategoryID: 1 });
      const res = await auth.get(`/api/inventory/barcodehistory/barcode/${barcode.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
