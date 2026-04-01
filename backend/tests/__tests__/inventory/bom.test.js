const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('BOM API', () => {
  // Helper: create a kit part (partCategoryID: 3 = Kit)
  async function createKitPart(overrides = {}) {
    return createTestPart({ name: `Kit-${Date.now()}`, partCategoryID: 3, ...overrides });
  }

  // Helper: create an assembly part (partCategoryID: 4 = Assembly)
  async function createAssemblyPart(overrides = {}) {
    return createTestPart({ name: `Asm-${Date.now()}`, partCategoryID: 4, ...overrides });
  }

  describe('GET /api/inventory/bom/:partId', () => {
    it('returns empty BOM for a new kit', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();

      const res = await auth.get(`/api/inventory/bom/${kit.id}`);
      expect(res.status).toBe(200);
      expect(res.body.bomItems).toEqual([]);
    });

    it('returns 404 for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/bom/99999');
      expect(res.status).toBe(404);
    });

    it('returns BOM items with component part details', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp1 = await createTestPart({ name: 'BOM-Comp1' });
      const comp2 = await createTestPart({ name: 'BOM-Comp2' });

      // Create BOM items directly
      await db.BillOfMaterialItem.bulkCreate([
        { partID: kit.id, componentPartID: comp1.id, quantity: 3, activeFlag: true },
        { partID: kit.id, componentPartID: comp2.id, quantity: 1, activeFlag: true },
      ]);

      const res = await auth.get(`/api/inventory/bom/${kit.id}`);
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(2);
      expect(res.body.bomItems[0].componentPart.name).toBe('BOM-Comp1');
      expect(res.body.bomItems[0].quantity).toBe(3);
    });

    it('does not return inactive BOM items', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: 'BOM-Inactive' });

      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 1, activeFlag: false
      });

      const res = await auth.get(`/api/inventory/bom/${kit.id}`);
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(0);
    });
  });

  describe('PUT /api/inventory/bom/:partId', () => {
    it('creates BOM items for a kit', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp1 = await createTestPart({ name: 'BOM-Put1' });
      const comp2 = await createTestPart({ name: 'BOM-Put2' });

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({
          bomItems: [
            { partID: comp1.id, quantity: 5 },
            { partID: comp2.id, quantity: 2 },
          ]
        });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(2);
    });

    it('creates BOM items for an assembly', async () => {
      const auth = await authenticatedRequest();
      const asm = await createAssemblyPart();
      const comp = await createTestPart({ name: 'BOM-AsmComp' });

      const res = await auth.put(`/api/inventory/bom/${asm.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(1);
    });

    it('replaces existing BOM items', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp1 = await createTestPart({ name: 'BOM-Old' });
      const comp2 = await createTestPart({ name: 'BOM-New' });

      // Initial BOM
      await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: comp1.id, quantity: 3 }] });

      // Replace
      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: comp2.id, quantity: 7 }] });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(1);
      expect(res.body.bomItems[0].componentPart.name).toBe('BOM-New');
      expect(res.body.bomItems[0].quantity).toBe(7);

      // Old item should be deactivated
      const oldItems = await db.BillOfMaterialItem.findAll({
        where: { partID: kit.id, componentPartID: comp1.id, activeFlag: true }
      });
      expect(oldItems.length).toBe(0);
    });

    it('rejects BOM for non-kit/assembly part', async () => {
      const auth = await authenticatedRequest();
      const regularPart = await createTestPart({ name: 'BOM-Regular' });
      const comp = await createTestPart({ name: 'BOM-Comp' });

      const res = await auth.put(`/api/inventory/bom/${regularPart.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('not a Kit or Assembly');
    });

    it('rejects self-reference', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: kit.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('cannot reference itself');
    });

    it('clears BOM when empty array sent', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      const comp = await createTestPart({ name: 'BOM-ToClear' });

      await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 1 }] });

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [] });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(0);
    });

    it('rejects invalid bomItems field', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: 'not-an-array' });
      expect(res.status).toBe(400);
    });

    it('rejects decimal quantity for integer-only UoM component', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      // UoM 1 = Each (allowDecimal: false)
      const comp = await createTestPart({ name: 'BOM-IntComp', defaultUnitOfMeasureID: 1 });

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 2.5 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('whole number');
    });

    it('allows decimal quantity for decimal UoM component', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart();
      // UoM 2 = Feet (allowDecimal: true)
      const comp = await createTestPart({ name: 'BOM-DecComp', defaultUnitOfMeasureID: 2 });

      const res = await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 2.5 }] });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(1);
      expect(res.body.bomItems[0].quantity).toBe(2.5);
    });
  });

  describe('Cycle Detection', () => {
    it('detects direct cycle (A→B→A)', async () => {
      const auth = await authenticatedRequest();
      const kitA = await createKitPart({ name: 'CycleA' });
      const kitB = await createKitPart({ name: 'CycleB' });

      // A contains B
      await auth.put(`/api/inventory/bom/${kitA.id}`)
        .send({ bomItems: [{ partID: kitB.id, quantity: 1 }] });

      // B tries to contain A → cycle
      const res = await auth.put(`/api/inventory/bom/${kitB.id}`)
        .send({ bomItems: [{ partID: kitA.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('Circular BOM reference');
    });

    it('detects indirect cycle (A→B→C→A)', async () => {
      const auth = await authenticatedRequest();
      const kitA = await createKitPart({ name: 'IndA' });
      const kitB = await createKitPart({ name: 'IndB' });
      const kitC = await createKitPart({ name: 'IndC' });

      // A→B
      await auth.put(`/api/inventory/bom/${kitA.id}`)
        .send({ bomItems: [{ partID: kitB.id, quantity: 1 }] });
      // B→C
      await auth.put(`/api/inventory/bom/${kitB.id}`)
        .send({ bomItems: [{ partID: kitC.id, quantity: 1 }] });
      // C→A should fail
      const res = await auth.put(`/api/inventory/bom/${kitC.id}`)
        .send({ bomItems: [{ partID: kitA.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('Circular BOM reference');
    });

    it('detects cross-type cycle (Kit→Assembly→Kit)', async () => {
      const auth = await authenticatedRequest();
      const kit = await createKitPart({ name: 'CrossKit' });
      const asm = await createAssemblyPart({ name: 'CrossAsm' });

      // Kit contains Assembly
      await auth.put(`/api/inventory/bom/${kit.id}`)
        .send({ bomItems: [{ partID: asm.id, quantity: 1 }] });

      // Assembly tries to contain Kit → cycle
      const res = await auth.put(`/api/inventory/bom/${asm.id}`)
        .send({ bomItems: [{ partID: kit.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.errorMessage).toContain('Circular BOM reference');
    });

    it('allows valid nesting (no cycle)', async () => {
      const auth = await authenticatedRequest();
      const kitA = await createKitPart({ name: 'NestA' });
      const kitB = await createKitPart({ name: 'NestB' });
      const comp = await createTestPart({ name: 'NestComp' });

      // B contains comp
      await auth.put(`/api/inventory/bom/${kitB.id}`)
        .send({ bomItems: [{ partID: comp.id, quantity: 2 }] });

      // A contains B — valid nesting
      const res = await auth.put(`/api/inventory/bom/${kitA.id}`)
        .send({ bomItems: [{ partID: kitB.id, quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.bomItems.length).toBe(1);
    });
  });
});
