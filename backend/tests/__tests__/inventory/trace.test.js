const { authenticatedRequest, createTestPart, createTestBarcode } = require('../../helpers');

describe('Trace API', () => {
  async function createTestTrace(overrides = {}) {
    const part = overrides.partID ? null : await createTestPart({ name: `TracePart-${Date.now()}` });
    const barcode = await createTestBarcode({ barcodeCategoryID: 1 });
    return db.Trace.create({
      partID: overrides.partID || part.id,
      quantity: overrides.quantity || 10,
      unitOfMeasureID: 1,
      barcodeID: barcode.id,
      activeFlag: true,
      ...overrides,
    });
  }

  describe('GET /api/inventory/trace', () => {
    it('gets traces by partID', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'TracePart-List' });
      await createTestTrace({ partID: part.id });
      await createTestTrace({ partID: part.id });

      const res = await auth.get(`/api/inventory/trace?partID=${part.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/inventory/trace/:id', () => {
    it('gets trace by id', async () => {
      const auth = await authenticatedRequest();
      const trace = await createTestTrace();
      const res = await auth.get(`/api/inventory/trace/${trace.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(trace.id);
    });
  });

  // Note: createNewTrace internally creates a Barcode which triggers PostgreSQL sequence hook
  describe('POST /api/inventory/trace', () => {
    it.skip('creates a trace (requires PostgreSQL barcode sequence)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'TracePart-Create' });

      const res = await auth.post('/api/inventory/trace')
        .send({
          partID: part.id,
          quantity: 25,
          unitOfMeasureID: 1,
          parentBarcodeID: 0,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.quantity).toBe(25);
    });
  });

  describe('PUT /api/inventory/trace/:id', () => {
    it('updates a trace', async () => {
      const auth = await authenticatedRequest();
      const trace = await createTestTrace();
      const res = await auth.put(`/api/inventory/trace/${trace.id}`)
        .send({ quantity: 50 });
      expect(res.status).toBe(200);
      const updated = await db.Trace.findByPk(trace.id);
      expect(updated.quantity).toBe(50);
    });
  });

  // Note: splitTrace internally creates a Barcode which triggers PostgreSQL sequence hook
  describe('POST /api/inventory/trace/split/:barcodeId', () => {
    it.skip('splits a trace (requires PostgreSQL barcode sequence)', async () => {
      const auth = await authenticatedRequest();
      const trace = await createTestTrace({ quantity: 100 });
      const res = await auth.post(`/api/inventory/trace/split/${trace.barcodeID}`)
        .send({ splitQuantity: 40 });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/inventory/trace/barcode/:barcodeId', () => {
    it('deletes trace by barcode', async () => {
      const auth = await authenticatedRequest();
      const trace = await createTestTrace();
      const res = await auth.delete(`/api/inventory/trace/barcode/${trace.barcodeID}`);
      expect(res.status).toBe(200);
      const deleted = await db.Trace.findByPk(trace.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
