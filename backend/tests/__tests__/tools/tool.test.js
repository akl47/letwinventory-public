const { authenticatedRequest, createTestPart, assignUserPermission } = require('../../helpers');

const TOOL_API = '/api/tools/tool';

// Seeded subcategory ids: 1=Hammer (Hand Tools), 12=Square End Mill (Mill Tools), 27=Drill Bit (Mill+Lathe+General)
async function handToolSub() { return db.ToolSubcategory.findOne({ where: { name: 'Hammer' } }); }
async function endMillSub()  { return db.ToolSubcategory.findOne({ where: { name: 'Square End Mill' } }); }

// REQs 290–298 (Tool CRUD, soft-delete preservation, permissions, immutability)
describe('Tool API', () => {
  describe('CRUD (REQ 291, 293)', () => {
    it('creates a tool with only required fields', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await handToolSub();

      const res = await auth.post(TOOL_API).send({
        partID: part.id,
        toolSubcategoryID: sub.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.partID).toBe(part.id);
      expect(res.body.toolSubcategoryID).toBe(sub.id);
      expect(res.body.activeFlag).toBe(true);
    });

    it('round-trips a fully-populated end mill', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await endMillSub();

      const create = await auth.post(TOOL_API).send({
        partID: part.id,
        toolSubcategoryID: sub.id,
        diameter: 6.350,
        overallLength: 76.200,
        fluteLength: 22.225,
        shankDiameter: 6.350,
        numberOfFlutes: 4,
        toolMaterial: 'Carbide',
        coating: 'AlTiN',
        notes: '4-flute square end mill',
      });
      expect(create.status).toBe(201);

      const res = await auth.get(`${TOOL_API}/${create.body.id}`);
      expect(res.status).toBe(200);
      expect(Number(res.body.diameter)).toBe(6.350);
      expect(Number(res.body.fluteLength)).toBe(22.225);
      expect(res.body.numberOfFlutes).toBe(4);
      expect(res.body.toolMaterial).toBe('Carbide');
      expect(res.body.coating).toBe('AlTiN');
      // Subcategory's categories surfaced via include
      expect(res.body.toolSubcategory.categories.map(c => c.name)).toContain('Mill Tools');
    });

    it('updates dimension fields via PUT', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await endMillSub();
      const t = await db.Tool.create({ partID: part.id, toolSubcategoryID: sub.id, diameter: 3 });

      const res = await auth.put(`${TOOL_API}/${t.id}`).send({ diameter: 4.5 });
      expect(res.status).toBe(200);
      expect(Number(res.body.diameter)).toBe(4.5);
    });
  });

  describe('Constraints (REQ 291, 298)', () => {
    it('409 on duplicate partID even when previous row is inactive', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await handToolSub();
      await db.Tool.create({ partID: part.id, toolSubcategoryID: sub.id, activeFlag: false });

      const res = await auth.post(TOOL_API).send({ partID: part.id, toolSubcategoryID: sub.id });
      expect(res.status).toBe(409);
    });

    it('400 on invalid toolSubcategoryID', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const res = await auth.post(TOOL_API).send({ partID: part.id, toolSubcategoryID: 99999 });
      expect(res.status).toBe(400);
    });

    it('ignores partID in PUT body (immutable)', async () => {
      const auth = await authenticatedRequest();
      const part1 = await createTestPart();
      const part2 = await createTestPart();
      const sub = await handToolSub();
      const t = await db.Tool.create({ partID: part1.id, toolSubcategoryID: sub.id });

      await auth.put(`${TOOL_API}/${t.id}`).send({ partID: part2.id, diameter: 5 });
      const reloaded = await db.Tool.findByPk(t.id);
      expect(reloaded.partID).toBe(part1.id);
      expect(Number(reloaded.diameter)).toBe(5);
    });
  });

  describe('Soft-delete preserves field values (REQ 294)', () => {
    it('PUT activeFlag=false keeps dimension values', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await endMillSub();
      const t = await db.Tool.create({
        partID: part.id, toolSubcategoryID: sub.id,
        diameter: 6, fluteLength: 20, numberOfFlutes: 4, toolMaterial: 'Carbide',
      });

      await auth.put(`${TOOL_API}/${t.id}`).send({ activeFlag: false });

      const reloaded = await db.Tool.findByPk(t.id);
      expect(reloaded.activeFlag).toBe(false);
      expect(Number(reloaded.diameter)).toBe(6);
      expect(Number(reloaded.fluteLength)).toBe(20);
      expect(reloaded.numberOfFlutes).toBe(4);
      expect(reloaded.toolMaterial).toBe('Carbide');
    });

    it('reactivation preserves all values', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await endMillSub();
      const t = await db.Tool.create({
        partID: part.id, toolSubcategoryID: sub.id,
        diameter: 6, fluteLength: 20, activeFlag: false,
      });

      const res = await auth.put(`${TOOL_API}/${t.id}`).send({ activeFlag: true });
      expect(res.status).toBe(200);
      expect(res.body.activeFlag).toBe(true);
      expect(Number(res.body.diameter)).toBe(6);
      expect(Number(res.body.fluteLength)).toBe(20);
    });

    it('DELETE soft-deletes without zeroing fields', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await handToolSub();
      const t = await db.Tool.create({
        partID: part.id, toolSubcategoryID: sub.id, diameter: 12.7, notes: 'keepme',
      });

      const res = await auth.delete(`${TOOL_API}/${t.id}`);
      expect(res.status).toBe(200);
      const reloaded = await db.Tool.findByPk(t.id);
      expect(reloaded.activeFlag).toBe(false);
      expect(Number(reloaded.diameter)).toBe(12.7);
      expect(reloaded.notes).toBe('keepme');
    });
  });

  describe('Lookup endpoints (REQ 295, 296)', () => {
    it('GET /by-part returns inactive rows', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await handToolSub();
      await db.Tool.create({ partID: part.id, toolSubcategoryID: sub.id, activeFlag: false });

      const res = await auth.get(`${TOOL_API}/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.activeFlag).toBe(false);
    });

    it('GET /by-part returns 404 only when no row exists', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const res = await auth.get(`${TOOL_API}/by-part/${part.id}`);
      expect(res.status).toBe(404);
    });

    it('list filters by subcategoryID', async () => {
      const auth = await authenticatedRequest();
      const partA = await createTestPart();
      const partB = await createTestPart();
      const handSub = await handToolSub();
      const millSub = await endMillSub();
      await db.Tool.create({ partID: partA.id, toolSubcategoryID: handSub.id });
      await db.Tool.create({ partID: partB.id, toolSubcategoryID: millSub.id });

      const res = await auth.get(`${TOOL_API}?subcategoryID=${millSub.id}`);
      expect(res.status).toBe(200);
      expect(res.body.every(t => t.toolSubcategoryID === millSub.id)).toBe(true);
    });

    it('list filters by categoryID (M:N traversal)', async () => {
      const auth = await authenticatedRequest();
      const partA = await createTestPart();
      const partB = await createTestPart();
      const handSub = await handToolSub();
      const millSub = await endMillSub();
      await db.Tool.create({ partID: partA.id, toolSubcategoryID: handSub.id });
      await db.Tool.create({ partID: partB.id, toolSubcategoryID: millSub.id });

      const res = await auth.get(`${TOOL_API}?categoryID=3`); // Mill Tools
      expect(res.status).toBe(200);
      expect(res.body.find(t => t.partID === partB.id)).toBeDefined();
      expect(res.body.find(t => t.partID === partA.id)).toBeUndefined();
    });

    it('list excludes inactive rows by default', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const sub = await handToolSub();
      await db.Tool.create({ partID: part.id, toolSubcategoryID: sub.id, activeFlag: false });

      const res = await auth.get(TOOL_API);
      expect(res.body.find(t => t.partID === part.id)).toBeUndefined();
    });
  });

  describe('Permissions (REQ 298)', () => {
    it('GET requires tools.read', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.get(TOOL_API);
      expect(res.status).toBe(403);
    });

    it('POST requires parts.write', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const allPerms = await db.Permission.findAll();
      for (const p of allPerms) {
        if (!(p.resource === 'parts' && p.action === 'write')) {
          await assignUserPermission(auth.user.id, p.id);
        }
      }
      const part = await createTestPart();
      const sub = await handToolSub();
      const res = await auth.post(TOOL_API).send({ partID: part.id, toolSubcategoryID: sub.id });
      expect(res.status).toBe(403);
    });

    it('DELETE requires parts.delete', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const allPerms = await db.Permission.findAll();
      for (const p of allPerms) {
        if (!(p.resource === 'parts' && p.action === 'delete')) {
          await assignUserPermission(auth.user.id, p.id);
        }
      }
      const part = await createTestPart();
      const sub = await handToolSub();
      const t = await db.Tool.create({ partID: part.id, toolSubcategoryID: sub.id });
      const res = await auth.delete(`${TOOL_API}/${t.id}`);
      expect(res.status).toBe(403);
    });
  });
});
