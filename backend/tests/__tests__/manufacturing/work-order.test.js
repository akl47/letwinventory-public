const {
  authenticatedRequest,
  createTestPart,
  createTestEngineeringMaster,
} = require('../../helpers');

const MASTER_API = '/api/manufacturing/master';
const WO_API = '/api/manufacturing/work-order';

/**
 * Helper: create a released master with steps for work order tests.
 */
async function createReleasedMaster(user) {
  const master = await createTestEngineeringMaster(user, {
    releaseState: 'released',
    revision: 'A',
    releasedAt: new Date(),
    releasedByUserID: user.id,
  });
  const step1 = await db.EngineeringMasterStep.create({
    engineeringMasterID: master.id,
    stepNumber: 10,
    title: 'Step 1',
    instructions: 'Do step 1',
  });
  const step2 = await db.EngineeringMasterStep.create({
    engineeringMasterID: master.id,
    stepNumber: 20,
    title: 'Step 2',
    instructions: 'Do step 2',
  });
  const step3 = await db.EngineeringMasterStep.create({
    engineeringMasterID: master.id,
    stepNumber: 30,
    title: 'Step 3',
    instructions: 'Do step 3',
  });
  return { master, steps: [step1, step2, step3] };
}

// REQ 241 — Work Order CRUD
describe('Work Order API', () => {
  describe('CRUD', () => {
    it('creates a work order from a released master', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);

      const res = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 5,
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('not_started');
      expect(res.body.quantity).toBe(5);
      expect(res.body.engineeringMasterID).toBe(master.id);
    });

    it('rejects work order from non-released master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'draft',
      });

      const res = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      expect(res.status).toBe(400);
    });

    it('lists work orders', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      await auth.post(WO_API).send({ engineeringMasterID: master.id, quantity: 1 });

      const res = await auth.get(WO_API);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('master');
    });

    it('filters work orders by status', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      await auth.post(WO_API).send({ engineeringMasterID: master.id, quantity: 1 });

      const res = await auth.get(`${WO_API}?status=not_started`);

      expect(res.status).toBe(200);
      expect(res.body.every(wo => wo.status === 'not_started')).toBe(true);
    });

    it('gets a single work order with step completions', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      const createRes = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 3,
      });

      const res = await auth.get(`${WO_API}/${createRes.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('master');
      expect(res.body).toHaveProperty('stepCompletions');
      expect(res.body.quantity).toBe(3);
    });

    it('deletes a not_started work order with a reason', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      const createRes = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      const res = await auth.delete(`${WO_API}/${createRes.body.id}`)
        .send({ deletionReason: 'Created in error' });

      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent work order', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.get(`${WO_API}/99999`);

      expect(res.status).toBe(404);
    });
  });

  // REQ 242 — Work Order Step Execution
  describe('Step Execution', () => {
    it('completes the first step', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      const res = await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });

      expect(res.status).toBe(200);
      expect(res.body.completedByUserID).toBe(auth.user.id);
      expect(res.body.completedAt).toBeTruthy();
    });

    it('transitions work order to in_progress on first step completion', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });

      const detail = await auth.get(`${WO_API}/${wo.body.id}`);
      expect(detail.body.status).toBe('in_progress');
    });

    it('enforces sequential step completion', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      // Try to complete step 2 without completing step 1
      const res = await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[1].id });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate step completion', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });

      const res = await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });

      expect(res.status).toBe(400);
    });

    it('uncompletes the most recently completed step', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });
      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[1].id });

      const res = await auth
        .post(`${WO_API}/${wo.body.id}/uncomplete-step`)
        .send({ stepID: steps[1].id });

      expect(res.status).toBe(200);
    });

    it('rejects uncomplete of non-most-recent step', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });
      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[1].id });

      // Try to uncomplete step 1 (not the most recent)
      const res = await auth
        .post(`${WO_API}/${wo.body.id}/uncomplete-step`)
        .send({ stepID: steps[0].id });

      expect(res.status).toBe(400);
    });

    it('completes the entire work order', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      // Complete all steps
      for (const step of steps) {
        await auth
          .post(`${WO_API}/${wo.body.id}/complete-step`)
          .send({ stepID: step.id });
      }

      const res = await auth.post(`${WO_API}/${wo.body.id}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('complete');
      expect(res.body.completedAt).toBeTruthy();
    });

    it('rejects complete with incomplete steps', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      // Only complete first step
      await auth
        .post(`${WO_API}/${wo.body.id}/complete-step`)
        .send({ stepID: steps[0].id });

      const res = await auth.post(`${WO_API}/${wo.body.id}/complete`);

      expect(res.status).toBe(400);
    });
  });

  // REQ 243 — Work Order Output Quantities
  describe('Output Quantities', () => {
    it('stores quantity at creation', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      const part = await createTestPart();
      await db.EngineeringMasterOutputPart.create({
        engineeringMasterID: master.id,
        partID: part.id,
        quantity: 1,
      });

      const wo = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 10,
      });

      expect(wo.status).toBe(201);
      expect(wo.body.quantity).toBe(10);

      // Verify quantity is immutable — detail view returns it
      const detail = await auth.get(`${WO_API}/${wo.body.id}`);
      expect(detail.body.quantity).toBe(10);
    });
  });

  // REQ 245 — Manufacturing Execution Permission
  describe('Permissions', () => {
    it('rejects unauthenticated requests', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });

      const res = await auth.get(WO_API);

      expect(res.status).toBe(403);
    });

    it('allows users with manufacturing_execution.read', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.get(WO_API);

      expect(res.status).toBe(200);
    });
  });

  // REQ 283-289 — Soft delete with reason, undelete, permissions
  describe('Soft Delete & Undelete', () => {
    async function createBarcodeForLocation() {
      const cat = await db.BarcodeCategory.findOne({ where: { prefix: 'LOC' } })
        || await db.BarcodeCategory.findOne({ where: { prefix: 'AKL' } });
      return db.Barcode.create({ barcodeCategoryID: cat.id, parentBarcodeID: 0, activeFlag: true });
    }

    async function createWoWithOutput(auth) {
      const { master } = await createReleasedMaster(auth.user);
      const part = await createTestPart();
      await db.EngineeringMasterOutputPart.create({
        engineeringMasterID: master.id,
        partID: part.id,
        quantity: 1,
      });
      const loc = await createBarcodeForLocation();
      const create = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 2,
        locationBarcodeID: loc.id,
      });
      return { woId: create.body.id, master, part };
    }

    it('soft-deletes a not_started WO and persists audit fields', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);

      const res = await auth.delete(`${WO_API}/${woId}`)
        .send({ deletionReason: 'Created in error' });

      expect(res.status).toBe(200);
      const wo = await db.WorkOrder.findByPk(woId);
      expect(wo.activeFlag).toBe(false);
      expect(wo.deletionReason).toBe('Created in error');
      expect(wo.deletedByUserID).toBe(auth.user.id);
      expect(wo.deletedAt).toBeTruthy();
    });

    it('soft-deletes an in_progress WO with a reason', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const create = await auth.post(WO_API).send({ engineeringMasterID: master.id, quantity: 1 });
      await auth.post(`${WO_API}/${create.body.id}/complete-step`).send({ stepID: steps[0].id });

      const res = await auth.delete(`${WO_API}/${create.body.id}`)
        .send({ deletionReason: 'Aborted' });

      expect(res.status).toBe(200);
    });

    it('rejects delete without a reason', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);

      const res = await auth.delete(`${WO_API}/${woId}`).send({});

      expect(res.status).toBe(400);
    });

    it('rejects delete of a completed WO', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const wo = await auth.post(WO_API).send({ engineeringMasterID: master.id, quantity: 1 });
      for (const step of steps) {
        await auth.post(`${WO_API}/${wo.body.id}/complete-step`).send({ stepID: step.id });
      }
      await auth.post(`${WO_API}/${wo.body.id}/complete`);

      const res = await auth.delete(`${WO_API}/${wo.body.id}`)
        .send({ deletionReason: 'Mistake' });

      expect(res.status).toBe(400);
    });

    it('deactivates output WIP traces and barcodes on delete', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);
      const tracesBefore = await db.Trace.findAll({ where: { workOrderID: woId } });
      expect(tracesBefore.length).toBeGreaterThan(0);
      expect(tracesBefore.every(t => t.activeFlag)).toBe(true);

      await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'cleanup' });

      const tracesAfter = await db.Trace.findAll({ where: { workOrderID: woId } });
      expect(tracesAfter.every(t => t.activeFlag === false)).toBe(true);
      for (const trace of tracesAfter) {
        const bc = await db.Barcode.findByPk(trace.barcodeID);
        expect(bc.activeFlag).toBe(false);
      }
    });

    it('reactivates output WIP traces and barcodes on undelete', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);
      await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'cleanup' });

      const res = await auth.post(`${WO_API}/${woId}/undelete`);

      expect(res.status).toBe(200);
      const wo = await db.WorkOrder.findByPk(woId);
      expect(wo.activeFlag).toBe(true);
      expect(wo.deletionReason).toBeNull();
      expect(wo.deletedByUserID).toBeNull();
      expect(wo.deletedAt).toBeNull();
      const traces = await db.Trace.findAll({ where: { workOrderID: woId } });
      expect(traces.every(t => t.activeFlag)).toBe(true);
      for (const trace of traces) {
        const bc = await db.Barcode.findByPk(trace.barcodeID);
        expect(bc.activeFlag).toBe(true);
      }
    });

    it('rejects undelete on a non-deleted WO', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);

      const res = await auth.post(`${WO_API}/${woId}/undelete`);

      expect(res.status).toBe(400);
    });

    it('does not modify kitted source traces when WO is deleted', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);
      const wipTrace = (await db.Trace.findAll({ where: { workOrderID: woId } }))[0];

      // Create a source trace and kit it into the WO's WIP output
      const sourcePart = await createTestPart();
      const aklCat = await db.BarcodeCategory.findOne({ where: { prefix: 'AKL' } });
      const sourceBarcode = await db.Barcode.create({ barcodeCategoryID: aklCat.id, parentBarcodeID: 0, activeFlag: true });
      const sourceTrace = await db.Trace.create({
        partID: sourcePart.id,
        quantity: 10,
        unitOfMeasureID: 1,
        barcodeID: sourceBarcode.id,
        activeFlag: true,
      });

      await auth.post(`/api/inventory/trace/kit/${sourceBarcode.id}`)
        .send({ targetBarcodeId: wipTrace.barcodeID, quantity: 3 });

      const sourceAfterKit = await db.Trace.findByPk(sourceTrace.id);
      const sourceQtyAfterKit = Number(sourceAfterKit.quantity);
      const kittedHistoryBefore = await db.BarcodeHistory.count({
        where: { barcodeID: sourceBarcode.id },
      });

      await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'change of plan' });

      const sourceAfterDelete = await db.Trace.findByPk(sourceTrace.id);
      expect(Number(sourceAfterDelete.quantity)).toBe(sourceQtyAfterKit);
      expect(sourceAfterDelete.activeFlag).toBe(sourceAfterKit.activeFlag);
      const kittedHistoryAfter = await db.BarcodeHistory.count({
        where: { barcodeID: sourceBarcode.id },
      });
      expect(kittedHistoryAfter).toBe(kittedHistoryBefore);
    });

    it('hides deleted WOs from default list and reveals via includeDeleted', async () => {
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);
      await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'cleanup' });

      const defaultList = await auth.get(WO_API);
      expect(defaultList.body.find(w => w.id === woId)).toBeUndefined();

      const includedList = await auth.get(`${WO_API}?includeDeleted=true`);
      expect(includedList.body.find(w => w.id === woId)).toBeDefined();
    });

    it('rejects delete without manufacturing_execution.work_order_delete', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });
      const { assignUserPermission } = require('../../helpers');
      // Grant everything except work_order_delete
      const allPerms = await db.Permission.findAll();
      for (const p of allPerms) {
        if (!(p.resource === 'manufacturing_execution' && p.action === 'work_order_delete')) {
          await assignUserPermission(auth.user.id, p.id);
        }
      }
      const { woId } = await createWoWithOutput(auth);

      const res = await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'x' });

      expect(res.status).toBe(403);
    });

    it('rejects undelete without manufacturing_execution.work_order_undelete', async () => {
      // Single-user setup: grant everything, delete a WO, then revoke the undelete perm.
      const auth = await authenticatedRequest();
      const { woId } = await createWoWithOutput(auth);
      await auth.delete(`${WO_API}/${woId}`).send({ deletionReason: 'x' });

      const undeletePerm = await db.Permission.findOne({
        where: { resource: 'manufacturing_execution', action: 'work_order_undelete' },
      });
      await db.UserPermission.destroy({
        where: { userID: auth.user.id, permissionID: undeletePerm.id },
      });

      const res = await auth.post(`${WO_API}/${woId}/undelete`);

      expect(res.status).toBe(403);
    });
  });
});
