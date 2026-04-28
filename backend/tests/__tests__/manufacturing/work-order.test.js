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

    it('deletes a not_started work order', async () => {
      const auth = await authenticatedRequest();
      const { master } = await createReleasedMaster(auth.user);
      const createRes = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      const res = await auth.delete(`${WO_API}/${createRes.body.id}`);

      expect(res.status).toBe(200);
    });

    it('rejects delete of started work order', async () => {
      const auth = await authenticatedRequest();
      const { master, steps } = await createReleasedMaster(auth.user);
      const createRes = await auth.post(WO_API).send({
        engineeringMasterID: master.id,
        quantity: 1,
      });

      // Complete first step to start it
      await auth.post(`${WO_API}/${createRes.body.id}/complete-step`).send({
        stepID: steps[0].id,
      });

      const res = await auth.delete(`${WO_API}/${createRes.body.id}`);

      expect(res.status).toBe(400);
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
});
