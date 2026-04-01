const { authenticatedRequest, createTestPart, createTestBarcode } = require('../../helpers');

describe('Build API', () => {
  async function createKitPart(overrides = {}) {
    return createTestPart({ name: `Kit-${Date.now()}-${Math.random()}`, partCategoryID: 3, ...overrides });
  }

  async function createAssemblyPart(overrides = {}) {
    return createTestPart({ name: `Asm-${Date.now()}-${Math.random()}`, partCategoryID: 4, ...overrides });
  }

  async function createTestTrace(overrides = {}) {
    const part = overrides.partID ? null : await createTestPart({ name: `Part-${Date.now()}-${Math.random()}` });
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

  describe('GET /api/inventory/trace/in-progress-builds', () => {
    it('returns partial kit traces', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `BuildComp-${Date.now()}` });

      // Create BOM
      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 5, activeFlag: true
      });

      // Create kit trace (unfulfilled = partial)
      await createTestTrace({ partID: kit.id, quantity: 1 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].partName).toBe(kit.name);
      expect(res.body[0].categoryName).toBe('Kit');
      expect(res.body[0].status).toBe('partial');
      expect(res.body[0].bomTotal).toBe(1);
      expect(res.body[0].bomFulfilled).toBe(0);
    });

    it('returns assembly traces', async () => {
      const auth = await authenticatedRequest();
      const asm = await createAssemblyPart();
      const comp = await createTestPart({ name: `AsmBuildComp-${Date.now()}` });

      await db.BillOfMaterialItem.create({
        partID: asm.id, componentPartID: comp.id, quantity: 3, activeFlag: true
      });

      await createTestTrace({ partID: asm.id, quantity: 1 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      expect(res.body.some(b => b.categoryName === 'Assembly')).toBe(true);
    });

    it('excludes complete builds', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: `CompleteComp-${Date.now()}` });

      // Create BOM
      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 5, activeFlag: true
      });

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const sourceTrace = await createTestTrace({ partID: comp.id, quantity: 20 });

      // Kit all required
      await auth.post(`/api/inventory/trace/kit/${sourceTrace.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 5 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      // The completed build should not appear
      expect(res.body.some(b => b.partName === kit.name)).toBe(false);
    });

    it('excludes kit traces with no BOM (empty BOM = complete)', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      await createTestTrace({ partID: kit.id, quantity: 1 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      expect(res.body.some(b => b.partName === kit.name)).toBe(false);
    });

    it('does not include regular part traces', async () => {
      const auth = await authenticatedRequest();
      const regularPart = await createTestPart({ name: `Regular-${Date.now()}` });
      await createTestTrace({ partID: regularPart.id, quantity: 10 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      expect(res.body.some(b => b.partName === regularPart.name)).toBe(false);
    });

    it('includes barcode and progress info', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp1 = await createTestPart({ name: `Prog1-${Date.now()}` });
      const comp2 = await createTestPart({ name: `Prog2-${Date.now()}` });

      await db.BillOfMaterialItem.bulkCreate([
        { partID: kit.id, componentPartID: comp1.id, quantity: 3, activeFlag: true },
        { partID: kit.id, componentPartID: comp2.id, quantity: 2, activeFlag: true },
      ]);

      const kitTrace = await createTestTrace({ partID: kit.id, quantity: 1 });
      const source1 = await createTestTrace({ partID: comp1.id, quantity: 10 });

      // Fulfill one BOM line
      await auth.post(`/api/inventory/trace/kit/${source1.barcodeID}`)
        .send({ targetBarcodeId: kitTrace.barcodeID, quantity: 3 });

      const res = await auth.get('/api/inventory/trace/in-progress-builds');
      expect(res.status).toBe(200);
      const build = res.body.find(b => b.partName === kit.name);
      expect(build).toBeDefined();
      expect(build.bomTotal).toBe(2);
      expect(build.bomFulfilled).toBe(1);
      expect(build.barcode).toBeDefined();
      expect(build.createdAt).toBeDefined();
    });
  });
});
