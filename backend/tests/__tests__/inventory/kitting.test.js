const { authenticatedRequest, createTestPart, createTestBarcode } = require('../../helpers');

describe('Kitting API', () => {
  // Helper: create a kit part (partCategoryID: 3 = Kit)
  async function createKitPart(overrides = {}) {
    return createTestPart({ name: `Kit-${Date.now()}-${Math.random()}`, partCategoryID: 3, ...overrides });
  }

  // Helper: create an assembly part (partCategoryID: 4 = Assembly)
  async function createAssemblyPart(overrides = {}) {
    return createTestPart({ name: `Asm-${Date.now()}-${Math.random()}`, partCategoryID: 4, ...overrides });
  }

  // Helper: create a trace with a barcode
  async function createTestTrace(overrides = {}) {
    const part = overrides.partID ? null : await createTestPart({ name: `KitPart-${Date.now()}-${Math.random()}` });
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

  describe('POST /api/inventory/trace/kit/:barcodeId', () => {
    it('kits a source trace to a kit trace', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `KitComp-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.quantity).toBe(15);

      // Verify DB
      const updatedSource = await db.Trace.findByPk(sourceTrace.id);
      expect(updatedSource.quantity).toBe(15);
      expect(updatedSource.activeFlag).toBe(true);
    });

    it('kits a source trace to an assembly trace', async () => {
      const auth = await authenticatedRequest();
      const asm = await createAssemblyPart();
      const comp = await createTestPart({ name: `AsmComp-${Date.now()}` });

      const asmTrace = await createTestTrace({ partID: asm.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: asmTrace.barcodeID, quantity: 3 });

      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.quantity).toBe(7);
    });

    it('deactivates source trace when quantity reaches 0', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `Deplete-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 5 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.activeFlag).toBe(false);

      const updated = await db.Trace.findByPk(sourceTrace.id);
      expect(updated.activeFlag).toBe(false);
    });

    it('records KITTED history on both source and target', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `HistComp-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 4 });

      // Check source history
      const sourceHistory = await db.BarcodeHistory.findAll({
        where: { barcodeID: sourceTrace.barcodeID },
        include: [{ model: db.BarcodeHistoryActionType, as: 'actionType' }]
      });
      expect(sourceHistory.some(h => h.actionType.code === 'KITTED')).toBe(true);

      // Check target history
      const targetHistory = await db.BarcodeHistory.findAll({
        where: { barcodeID: kitTrace.barcodeID },
        include: [{ model: db.BarcodeHistoryActionType, as: 'actionType' }]
      });
      expect(targetHistory.some(h => h.actionType.code === 'KITTED')).toBe(true);
    });

    it('rejects kitting to a non-kit/assembly trace', async () => {
      const auth = await authenticatedRequest();
      const regularPart = await createTestPart({ name: `RegPart-${Date.now()}` });
      const comp = await createTestPart({ name: `RegComp-${Date.now()}` });

      const regularTrace = await createTestTrace({ partID: regularPart.id, quantity: 10 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: regularTrace.barcodeID, quantity: 5 });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('not a Kit, Assembly, or Work Order output');
    });

    it('rejects insufficient quantity', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `InsComp-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 3 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 10 });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('Insufficient quantity');
    });

    it('returns 404 for nonexistent source trace', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });

      const res = await auth.post('/api/inventory/trace/kit/99999')
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent target trace', async () => {
      const auth = await authenticatedRequest();
      const comp = await createTestPart({ name: `MissTgt-${Date.now()}` });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: 99999, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects decimal quantity for integer-only UoM', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `DecKit-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      // unitOfMeasureID: 1 = Each (allowDecimal: false)
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10, unitOfMeasureID: 1 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 2.5 });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('whole number');
    });

    it('allows decimal quantity for decimal UoM', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `DecKitOk-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      // unitOfMeasureID: 2 = Feet (allowDecimal: true)
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10, unitOfMeasureID: 2 });

      const res = await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 2.5 });
      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.quantity).toBe(7.5);
    });
  });

  describe('POST /api/inventory/trace/unkit/:barcodeId', () => {
    it('unkits quantity back to source trace', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `UnkitComp-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      // Kit first
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 8 });

      // Unkit
      const res = await auth.post(`/api/inventory/trace/unkit/${kitTrace.barcodeID}`)
        .send({ targetBarcodeId: sourceTrace.barcodeID, quantity: 8 });

      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.quantity).toBe(20);
    });

    it('reactivates a deactivated source trace', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `Reactivate-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 5 });

      // Kit all — source deactivated
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      const deactivated = await db.Trace.findByPk(sourceTrace.id);
      expect(deactivated.activeFlag).toBe(false);

      // Unkit — source reactivated
      const res = await auth.post(`/api/inventory/trace/unkit/${kitTrace.barcodeID}`)
        .send({ targetBarcodeId: sourceTrace.barcodeID, quantity: 5 });

      expect(res.status).toBe(200);
      expect(res.body.sourceTrace.activeFlag).toBe(true);

      const reactivated = await db.Trace.findByPk(sourceTrace.id);
      expect(reactivated.activeFlag).toBe(true);
      expect(reactivated.quantity).toBe(5);
    });

    it('records UNKITTED history on both traces', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `UnkitHist-${Date.now()}` });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 3 });

      await auth.post(`/api/inventory/trace/unkit/${kitTrace.barcodeID}`)
        .send({ targetBarcodeId: sourceTrace.barcodeID, quantity: 3 });

      const kitHistory = await db.BarcodeHistory.findAll({
        where: { barcodeID: kitTrace.barcodeID },
        include: [{ model: db.BarcodeHistoryActionType, as: 'actionType' }]
      });
      expect(kitHistory.some(h => h.actionType.code === 'UNKITTED')).toBe(true);

      const sourceHistory = await db.BarcodeHistory.findAll({
        where: { barcodeID: sourceTrace.barcodeID },
        include: [{ model: db.BarcodeHistoryActionType, as: 'actionType' }]
      });
      expect(sourceHistory.some(h => h.actionType.code === 'UNKITTED')).toBe(true);
    });

    it('rejects unkit from a non-kit/assembly trace', async () => {
      const auth = await authenticatedRequest();
      const regularPart = await createTestPart({ name: `UnkitReg-${Date.now()}` });
      const comp = await createTestPart({ name: `UnkitRegComp-${Date.now()}` });

      const regularTrace = await createTestTrace({ partID: regularPart.id, quantity: 10 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      const res = await auth.post(`/api/inventory/trace/unkit/${regularTrace.barcodeID}`)
        .send({ targetBarcodeId: sourceTrace.barcodeID, quantity: 5 });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('not a Kit, Assembly, or Work Order output');
    });
  });

  describe('GET /api/inventory/trace/kit-status/:barcodeId', () => {
    it('returns partial status for incomplete kit', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `StatusComp-${Date.now()}` });

      // Create BOM: needs 10 of comp
      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 10, activeFlag: true
      });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      // Kit only 5 of 10 required
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      const res = await auth.get(`/api/inventory/trace/kit-status/${kitTrace.barcodeID}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('partial');
      expect(res.body.bomLines.length).toBe(1);
      expect(res.body.bomLines[0].requiredQty).toBe(10);
      expect(res.body.bomLines[0].kittedQty).toBe(5);
    });

    it('returns complete status for fully kitted kit', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `FullComp-${Date.now()}` });

      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 5, activeFlag: true
      });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      // Kit exactly 5
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      const res = await auth.get(`/api/inventory/trace/kit-status/${kitTrace.barcodeID}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('complete');
    });

    it('returns complete for kit with no BOM', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });

      const res = await auth.get(`/api/inventory/trace/kit-status/${kitTrace.barcodeID}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('complete');
    });

    it('returns complete for assembly fulfillment', async () => {
      const auth = await authenticatedRequest();
      const asm = await createAssemblyPart();
      const comp = await createTestPart({ name: `AsmStatusComp-${Date.now()}` });

      await db.BillOfMaterialItem.create({
        partID: asm.id, componentPartID: comp.id, quantity: 3, activeFlag: true
      });

      const asmTrace = await createTestTrace({ partID: asm.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 10 });

      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: asmTrace.barcodeID, quantity: 3 });

      const res = await auth.get(`/api/inventory/trace/kit-status/${asmTrace.barcodeID}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('complete');
    });

    it('accounts for unkitting in status calculation', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `UnkitStatus-${Date.now()}` });

      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 10, activeFlag: true
      });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      // Kit 10
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 10 });

      // Verify complete
      let res = await auth.get(`/api/inventory/trace/kit-status/${kitTrace.barcodeID}`);
      expect(res.body.status).toBe('complete');

      // Unkit 5
      await auth.post(`/api/inventory/trace/unkit/${kitTrace.barcodeID}`)
        .send({ targetBarcodeId: sourceTrace.barcodeID, quantity: 5 });

      // Should now be partial
      res = await auth.get(`/api/inventory/trace/kit-status/${kitTrace.barcodeID}`);
      expect(res.body.status).toBe('partial');
      expect(res.body.bomLines[0].kittedQty).toBe(5);
    });

    it('rejects non-kit/assembly trace', async () => {
      const auth = await authenticatedRequest();
      const regularPart = await createTestPart({ name: `RegStatus-${Date.now()}` });
      const regularTrace = await createTestTrace({ partID: regularPart.id, quantity: 10 });

      const res = await auth.get(`/api/inventory/trace/kit-status/${regularTrace.barcodeID}`);
      expect(res.status).toBe(400);
    });
  });
});
