const { authenticatedRequest, createTestPart, assignUserPermission } = require('../../helpers');

const CAT_API = '/api/tools/tool-category';
const SUB_API = '/api/tools/tool-subcategory';

const SEEDED_CATEGORIES = ['Hand Tools', 'Power Tools', 'Mill Tools', 'Lathe Tools', 'General Purpose'];

// REQ 292 — categories + subcategories seeded; REQ 299 — admin.manage_tool_categories
describe('Tool Category API', () => {
  describe('Seeding (REQ 292)', () => {
    it('seeds the 5 expected categories', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get(CAT_API);
      expect(res.status).toBe(200);
      const names = res.body.map(c => c.name).sort();
      expect(names).toEqual([...SEEDED_CATEGORIES].sort());
    });

    it('exposes subcategories on each category via the M:N join', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get(CAT_API);
      const handTools = res.body.find(c => c.name === 'Hand Tools');
      expect(handTools.subcategories.length).toBe(7);
      const millTools = res.body.find(c => c.name === 'Mill Tools');
      const millNames = millTools.subcategories.map(s => s.name);
      expect(millNames).toContain('Square End Mill');
      expect(millNames).toContain('Drill Bit');
    });

    it('a subcategory can belong to multiple categories', async () => {
      const sub = await db.ToolSubcategory.findOne({
        where: { name: 'Drill Bit' },
        include: [{ model: db.ToolCategory, as: 'categories' }],
      });
      const catNames = sub.categories.map(c => c.name).sort();
      expect(catNames).toEqual(['General Purpose', 'Lathe Tools', 'Mill Tools']);
    });
  });

  describe('GET (REQ 298 — tools.read)', () => {
    it('200 with tools.read', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get(CAT_API);
      expect(res.status).toBe(200);
    });

    it('403 without tools.read', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.get(CAT_API);
      expect(res.status).toBe(403);
    });
  });

  describe('POST (REQ 299 — admin.manage_tool_categories)', () => {
    it('201 with admin.manage_tool_categories', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post(CAT_API).send({ name: 'Custom Group', description: 'test' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Custom Group');
    });

    it('409 on duplicate name', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post(CAT_API).send({ name: 'Mill Tools' });
      expect(res.status).toBe(409);
    });

    it('403 without admin.manage_tool_categories', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const allPerms = await db.Permission.findAll();
      for (const p of allPerms) {
        if (!(p.resource === 'admin' && p.action === 'manage_tool_categories')) {
          await assignUserPermission(auth.user.id, p.id);
        }
      }
      const res = await auth.post(CAT_API).send({ name: 'New cat' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE (REQ 299)', () => {
    it('soft-deletes a category not referenced by any active tool', async () => {
      const auth = await authenticatedRequest();
      const cat = await db.ToolCategory.create({ name: 'Disposable' });
      const res = await auth.delete(`${CAT_API}/${cat.id}`);
      expect(res.status).toBe(200);
      const reloaded = await db.ToolCategory.findByPk(cat.id);
      expect(reloaded.activeFlag).toBe(false);
    });

    it('refuses (400) when an active Tool references a subcategory under the category', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      // Mill Tools (id=3) contains Square End Mill (id=12)
      await db.Tool.create({ partID: part.id, toolSubcategoryID: 12, activeFlag: true });

      const res = await auth.delete(`${CAT_API}/3`);
      expect(res.status).toBe(400);
    });
  });
});

// Tool Subcategory tests
describe('Tool Subcategory API', () => {
  describe('GET', () => {
    it('lists 36 seeded subcategories with their categories included', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get(SUB_API);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(36);
      const drillBit = res.body.find(s => s.name === 'Drill Bit');
      expect(drillBit.categories.map(c => c.name).sort()).toEqual(
        ['General Purpose', 'Lathe Tools', 'Mill Tools']
      );
    });

    it('filters by categoryID', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get(`${SUB_API}?categoryID=1`); // Hand Tools
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(7);
    });

    it('403 without tools.read', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const res = await auth.get(SUB_API);
      expect(res.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('creates a subcategory with category links', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post(SUB_API).send({
        name: 'Custom Subcategory', categoryIDs: [1, 2],
      });
      expect(res.status).toBe(201);
      expect(res.body.categories.length).toBe(2);
    });

    it('rejects (400) when categoryIDs is empty', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post(SUB_API).send({ name: 'No Cats', categoryIDs: [] });
      expect(res.status).toBe(400);
    });

    it('rejects (400) when a categoryID is invalid', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post(SUB_API).send({ name: 'Bad Cat', categoryIDs: [999] });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT', () => {
    it('replaces category links when categoryIDs is provided', async () => {
      const auth = await authenticatedRequest();
      const create = await auth.post(SUB_API).send({ name: 'Movable', categoryIDs: [1] });
      const id = create.body.id;

      const res = await auth.put(`${SUB_API}/${id}`).send({ categoryIDs: [2, 3] });
      expect(res.status).toBe(200);
      expect(res.body.categories.map(c => c.id).sort()).toEqual([2, 3]);
    });
  });

  describe('DELETE', () => {
    it('soft-deletes an unreferenced subcategory', async () => {
      const auth = await authenticatedRequest();
      const create = await auth.post(SUB_API).send({ name: 'TempSub', categoryIDs: [1] });
      const res = await auth.delete(`${SUB_API}/${create.body.id}`);
      expect(res.status).toBe(200);
    });

    it('refuses (400) when an active Tool references the subcategory', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      await db.Tool.create({ partID: part.id, toolSubcategoryID: 1 }); // Hammer

      const res = await auth.delete(`${SUB_API}/1`);
      expect(res.status).toBe(400);
    });
  });
});
