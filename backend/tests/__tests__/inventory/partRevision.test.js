const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('Part Revisions API', () => {
  describe('Default Revisions', () => {
    it('external part defaults to revision 00', async () => {
      const part = await createTestPart({ name: `ExtPart-${Date.now()}`, internalPart: false });
      expect(part.revision).toBe('00');
    });

    it('internal part defaults to revision 01', async () => {
      const part = await createTestPart({ name: `IntPart-${Date.now()}`, internalPart: true });
      expect(part.revision).toBe('01');
    });

    it('defaults revisionLocked to false', async () => {
      const part = await createTestPart({ name: `LockDefault-${Date.now()}` });
      expect(part.revisionLocked).toBe(false);
    });

    it('defaults previousRevisionID to null', async () => {
      const part = await createTestPart({ name: `PrevDefault-${Date.now()}` });
      expect(part.previousRevisionID ?? null).toBeNull();
    });
  });

  describe('Unique Constraint (name + revision)', () => {
    it('cannot create two parts with same name and revision', async () => {
      const name = `UniqueTest-${Date.now()}`;
      await createTestPart({ name, revision: '01' });

      await expect(
        createTestPart({ name, revision: '01' })
      ).rejects.toThrow();
    });

    it('allows same name with different revisions', async () => {
      const name = `SameNameDiffRev-${Date.now()}`;
      const part1 = await createTestPart({ name, revision: '01' });
      const part2 = await createTestPart({ name, revision: '02' });

      expect(part1.id).not.toBe(part2.id);
      expect(part1.name).toBe(part2.name);
      expect(part1.revision).toBe('01');
      expect(part2.revision).toBe('02');
    });
  });

  describe('POST /api/inventory/part/:id/new-revision', () => {
    it('creates next dev revision 01 -> 02', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `DevRev-${Date.now()}`, internalPart: true, revision: '01' });

      const res = await auth.post(`/api/inventory/part/${part.id}/new-revision`);
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('02');
      expect(res.body.name).toBe(part.name);
      expect(res.body.previousRevisionID).toBe(part.id);
    });

    it('creates next dev revision 02 -> 03', async () => {
      const auth = await authenticatedRequest();
      const name = `DevRev2-${Date.now()}`;
      const part = await createTestPart({ name, internalPart: true, revision: '02' });

      const res = await auth.post(`/api/inventory/part/${part.id}/new-revision`);
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('03');
    });

    it('returns 404 for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/inventory/part/99999/new-revision');
      expect(res.status).toBe(404);
    });

    it('copies BOM items to the new revision', async () => {
      const auth = await authenticatedRequest();
      const kit = await createTestPart({ name: `BOMCopyKit-${Date.now()}`, partCategoryID: 3, internalPart: true, revision: '01' });
      const comp1 = await createTestPart({ name: `BOMCopyComp1-${Date.now()}` });
      const comp2 = await createTestPart({ name: `BOMCopyComp2-${Date.now()}` });

      await db.BillOfMaterialItem.bulkCreate([
        { partID: kit.id, componentPartID: comp1.id, quantity: 3, activeFlag: true },
        { partID: kit.id, componentPartID: comp2.id, quantity: 5, activeFlag: true },
      ]);

      const res = await auth.post(`/api/inventory/part/${kit.id}/new-revision`);
      expect(res.status).toBe(200);

      const newPartId = res.body.id;
      const bomItems = await db.BillOfMaterialItem.findAll({
        where: { partID: newPartId, activeFlag: true },
      });
      expect(bomItems.length).toBe(2);

      const quantities = bomItems.map(b => b.quantity).sort();
      expect(quantities).toEqual([3, 5]);

      const componentIds = bomItems.map(b => b.componentPartID).sort();
      expect(componentIds).toEqual([comp1.id, comp2.id].sort());
    });

    it('does not copy inactive BOM items', async () => {
      const auth = await authenticatedRequest();
      const kit = await createTestPart({ name: `BOMCopyInactive-${Date.now()}`, partCategoryID: 3, internalPart: true, revision: '01' });
      const comp = await createTestPart({ name: `BOMCopyInactiveComp-${Date.now()}` });

      await db.BillOfMaterialItem.create({
        partID: kit.id, componentPartID: comp.id, quantity: 1, activeFlag: false,
      });

      const res = await auth.post(`/api/inventory/part/${kit.id}/new-revision`);
      expect(res.status).toBe(200);

      const bomItems = await db.BillOfMaterialItem.findAll({
        where: { partID: res.body.id, activeFlag: true },
      });
      expect(bomItems.length).toBe(0);
    });
  });

  describe('POST /api/inventory/part/:id/release', () => {
    it('creates first production release as revision A', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `Release-${Date.now()}`, internalPart: true, revision: '01' });

      const res = await auth.post(`/api/inventory/part/${part.id}/release`);
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('A');
      expect(res.body.previousRevisionID).toBe(part.id);
    });

    it('creates second production release as revision B', async () => {
      const auth = await authenticatedRequest();
      const name = `Release2-${Date.now()}`;
      const partA = await createTestPart({ name, internalPart: true, revision: 'A' });

      const res = await auth.post(`/api/inventory/part/${partA.id}/release`);
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe('B');
    });

    it('locks the source part after release', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `ReleaseLock-${Date.now()}`, internalPart: true, revision: '01' });

      await auth.post(`/api/inventory/part/${part.id}/release`);

      const updated = await db.Part.findByPk(part.id);
      expect(updated.revisionLocked).toBe(true);
    });

    it('returns 404 for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/inventory/part/99999/release');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/inventory/part/:id/lock', () => {
    it('locks a part revision', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `Lock-${Date.now()}` });

      const res = await auth.put(`/api/inventory/part/${part.id}/lock`);
      expect(res.status).toBe(200);

      const updated = await db.Part.findByPk(part.id);
      expect(updated.revisionLocked).toBe(true);
    });

    it('returns 404 for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/inventory/part/99999/lock');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/inventory/part/:id/unlock', () => {
    it('unlocks a locked part revision', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `Unlock-${Date.now()}`, revisionLocked: true });

      const res = await auth.put(`/api/inventory/part/${part.id}/unlock`);
      expect(res.status).toBe(200);

      const updated = await db.Part.findByPk(part.id);
      expect(updated.revisionLocked).toBe(false);
    });

    it('returns 404 for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.put('/api/inventory/part/99999/unlock');
      expect(res.status).toBe(404);
    });
  });

  describe('Cannot edit locked revision', () => {
    it('returns 403 when updating a locked part', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `LockedEdit-${Date.now()}`, revisionLocked: true });

      const res = await auth.put(`/api/inventory/part/${part.id}`)
        .send({
          name: part.name,
          description: 'Trying to edit locked part',
          internalPart: false,
          vendor: 'Test Vendor',
          minimumOrderQuantity: 1,
          partCategoryID: 1,
          serialNumberRequired: false,
          lotNumberRequired: false,
          manufacturer: 'TestMfg',
          manufacturerPN: 'MFG-001',
        });
      expect(res.status).toBe(403);
    });
  });

  describe('Revision History', () => {
    describe('POST /api/inventory/part (create)', () => {
      it('records history entry with changeType created', async () => {
        const auth = await authenticatedRequest();

        const res = await auth.post('/api/inventory/part')
          .send({
            name: `HistCreate-${Date.now()}`,
            description: 'History test',
            internalPart: true,
            vendor: 'TestVendor',
            minimumOrderQuantity: 1,
            partCategoryID: 1,
            serialNumberRequired: false,
            lotNumberRequired: false,
          });
        expect([200, 201]).toContain(res.status);

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: res.body.id },
        });
        expect(history.length).toBe(1);
        expect(history[0].changeType).toBe('created');
        expect(history[0].changedByUserID).toBeDefined();
      });
    });

    describe('PUT /api/inventory/part/:id (update)', () => {
      it('records history entry with changeType updated and field diffs', async () => {
        const auth = await authenticatedRequest();
        const part = await createTestPart({ name: `HistUpdate-${Date.now()}`, description: 'Before' });

        await auth.put(`/api/inventory/part/${part.id}`)
          .send({
            name: part.name,
            description: 'After',
            internalPart: false,
            vendor: 'Test Vendor',
            minimumOrderQuantity: 1,
            partCategoryID: 1,
            serialNumberRequired: false,
            lotNumberRequired: false,
            manufacturer: 'TestMfg',
            manufacturerPN: 'MFG-001',
          });

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: part.id, changeType: 'updated' },
        });
        expect(history.length).toBe(1);
        expect(history[0].changes).toBeDefined();
        expect(history[0].changes.description).toBeDefined();
        expect(history[0].changes.description.old).toBe('Before');
        expect(history[0].changes.description.new).toBe('After');
      });
    });

    describe('Lock/Unlock history', () => {
      it('records history when locking a part', async () => {
        const auth = await authenticatedRequest();
        const part = await createTestPart({ name: `HistLock-${Date.now()}` });

        await auth.put(`/api/inventory/part/${part.id}/lock`);

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: part.id, changeType: 'locked' },
        });
        expect(history.length).toBe(1);
      });

      it('records history when unlocking a part', async () => {
        const auth = await authenticatedRequest();
        const part = await createTestPart({ name: `HistUnlock-${Date.now()}`, revisionLocked: true });

        await auth.put(`/api/inventory/part/${part.id}/unlock`);

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: part.id, changeType: 'unlocked' },
        });
        expect(history.length).toBe(1);
      });
    });

    describe('New revision history', () => {
      it('records history with changeType new_revision', async () => {
        const auth = await authenticatedRequest();
        const part = await createTestPart({ name: `HistNewRev-${Date.now()}`, internalPart: true, revision: '01' });

        const res = await auth.post(`/api/inventory/part/${part.id}/new-revision`);
        expect(res.status).toBe(200);

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: res.body.id, changeType: 'new_revision' },
        });
        expect(history.length).toBe(1);
        expect(history[0].changedByUserID).toBeDefined();
      });
    });

    describe('Release history', () => {
      it('records history with changeType production_release', async () => {
        const auth = await authenticatedRequest();
        const part = await createTestPart({ name: `HistRelease-${Date.now()}`, internalPart: true, revision: '01' });

        const res = await auth.post(`/api/inventory/part/${part.id}/release`);
        expect(res.status).toBe(200);

        const history = await db.PartRevisionHistory.findAll({
          where: { partID: res.body.id, changeType: 'production_release' },
        });
        expect(history.length).toBe(1);
        expect(history[0].changedByUserID).toBeDefined();
      });
    });
  });

  describe('GET /api/inventory/part/:id/revision-history', () => {
    it('returns history entries with user info ordered by most recent', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: `GetHist-${Date.now()}`, internalPart: true, revision: '01' });

      // Trigger some history by locking then unlocking
      await auth.put(`/api/inventory/part/${part.id}/lock`);
      await auth.put(`/api/inventory/part/${part.id}/unlock`);

      const res = await auth.get(`/api/inventory/part/${part.id}/revision-history`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Most recent first
      const timestamps = res.body.map(h => new Date(h.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }

      // User info included
      expect(res.body[0].changedByUserID).toBeDefined();
    });

    it('returns empty array for nonexistent part', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/part/99999/revision-history');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/inventory/part/revisions/:name', () => {
    it('returns all revisions of a part by name ordered by createdAt', async () => {
      const auth = await authenticatedRequest();
      const name = `MultiRev-${Date.now()}`;
      const part01 = await createTestPart({ name, internalPart: true, revision: '01' });
      const part02 = await createTestPart({ name, internalPart: true, revision: '02', previousRevisionID: part01.id });
      const partA = await createTestPart({ name, internalPart: true, revision: 'A', previousRevisionID: part02.id });

      const res = await auth.get(`/api/inventory/part/revisions/${encodeURIComponent(name)}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);

      // Ordered by createdAt
      const timestamps = res.body.map(p => new Date(p.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }

      const revisions = res.body.map(p => p.revision);
      expect(revisions).toContain('01');
      expect(revisions).toContain('02');
      expect(revisions).toContain('A');
    });

    it('returns empty array for unknown part name', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/part/revisions/NonexistentPart-99999');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
