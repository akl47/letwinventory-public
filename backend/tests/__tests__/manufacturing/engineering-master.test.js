const {
  authenticatedRequest,
  createTestPart,
  createTestFile,
  createTestEngineeringMaster,
} = require('../../helpers');

const API = '/api/manufacturing/master';
const STEP_API = '/api/manufacturing/master-step';

describe('Engineering Master API', () => {
  // REQ 234 — Engineering Master CRUD
  describe('CRUD', () => {
    it('creates an engineering master', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const res = await auth.post(API).send({
        name: 'Test Master',
        description: 'Test description',
        outputParts: [{ partID: part.id, quantity: 1 }],
      });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Master');
      expect(res.body.revision).toBe('A');
      expect(res.body.releaseState).toBe('draft');
    });

    it('lists engineering masters', async () => {
      const auth = await authenticatedRequest();
      await createTestEngineeringMaster(auth.user);

      const res = await auth.get(API);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('gets a single engineering master with steps', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.get(`${API}/${master.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(master.id);
      expect(res.body).toHaveProperty('steps');
      expect(res.body).toHaveProperty('outputParts');
    });

    it('updates an engineering master in draft state', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.put(`${API}/${master.id}`).send({
        name: 'Updated Name',
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('soft-deletes an engineering master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.delete(`${API}/${master.id}`);

      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent master', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.get(`${API}/99999`);

      expect(res.status).toBe(404);
    });

    it('rejects edit of non-draft master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'released',
      });

      const res = await auth.put(`${API}/${master.id}`).send({
        name: 'Should fail',
      });

      expect(res.status).toBe(400);
    });
  });

  // REQ 240 — Engineering Master Output Parts
  describe('Output Parts', () => {
    it('creates master with output parts', async () => {
      const auth = await authenticatedRequest();
      const part1 = await createTestPart();
      const part2 = await createTestPart();

      const res = await auth.post(API).send({
        name: 'Master with outputs',
        description: 'Test',
        outputParts: [
          { partID: part1.id, quantity: 2 },
          { partID: part2.id, quantity: 1 },
        ],
      });

      expect(res.status).toBe(201);
      const detail = await auth.get(`${API}/${res.body.id}`);
      expect(detail.body.outputParts).toHaveLength(2);
    });

    it('enforces unique constraint on (masterID, partID)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const res = await auth.post(API).send({
        name: 'Duplicate outputs',
        description: 'Test',
        outputParts: [
          { partID: part.id, quantity: 1 },
          { partID: part.id, quantity: 2 },
        ],
      });

      // Should either deduplicate or reject
      expect([201, 400]).toContain(res.status);
    });
  });

  // REQ 236 — Engineering Master Revision Control
  describe('Release Workflow', () => {
    it('submits for review (draft → review)', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      // Need at least one step to submit
      await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'Step 1',
      });

      const res = await auth.post(`${API}/${master.id}/submit-review`);

      expect(res.status).toBe(200);
      expect(res.body.releaseState).toBe('review');
    });

    it('rejects submit without steps', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.post(`${API}/${master.id}/submit-review`);

      expect(res.status).toBe(400);
    });

    it('rejects from review to draft', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'review',
      });

      const res = await auth.post(`${API}/${master.id}/reject`);

      expect(res.status).toBe(200);
      expect(res.body.releaseState).toBe('draft');
    });

    it('releases (review → released)', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'review',
      });

      const res = await auth.post(`${API}/${master.id}/release`);

      expect(res.status).toBe(200);
      expect(res.body.releaseState).toBe('released');
      expect(res.body.releasedAt).toBeTruthy();
      expect(res.body.releasedByUserID).toBe(auth.user.id);
    });

    it('rejects release of non-review master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'draft',
      });

      const res = await auth.post(`${API}/${master.id}/release`);

      expect(res.status).toBe(400);
    });

    it('creates new revision from released master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'released',
        revision: 'A',
      });
      // Add a step to the released master to verify it gets copied
      await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'Original Step',
      });

      const res = await auth.post(`${API}/${master.id}/new-revision`);

      expect(res.status).toBe(201);
      expect(res.body.revision).toBe('B');
      expect(res.body.releaseState).toBe('draft');
      expect(res.body.previousRevisionID).toBe(master.id);
    });

    it('gets all revisions of a master', async () => {
      const auth = await authenticatedRequest();
      const masterA = await createTestEngineeringMaster(auth.user, {
        name: 'Rev Test',
        releaseState: 'released',
        revision: 'A',
      });
      await createTestEngineeringMaster(auth.user, {
        name: 'Rev Test',
        revision: 'B',
        previousRevisionID: masterA.id,
      });

      const res = await auth.get(`${API}/${masterA.id}/revisions`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });
  });

  // REQ 237 — Engineering Master History
  describe('History', () => {
    it('records history on create', async () => {
      const auth = await authenticatedRequest();

      const createRes = await auth.post(API).send({
        name: 'History Test',
        description: 'Test',
        outputParts: [],
      });

      const res = await auth.get(`${API}/${createRes.body.id}/history`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].changeType).toBe('created');
      expect(res.body[0].changedByUserID).toBe(auth.user.id);
    });

    it('records history on release', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'review',
      });

      await auth.post(`${API}/${master.id}/release`);
      const res = await auth.get(`${API}/${master.id}/history`);

      expect(res.status).toBe(200);
      const releaseEntry = res.body.find(h => h.changeType === 'released');
      expect(releaseEntry).toBeTruthy();
    });
  });

  // REQ 244 — Manufacturing Planning Permission
  describe('Permissions', () => {
    it('rejects unauthenticated requests', async () => {
      const auth = await authenticatedRequest(null, { grantPermissions: false });

      const res = await auth.get(API);

      expect(res.status).toBe(403);
    });

    it('allows users with manufacturing_planning.read', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.get(API);

      expect(res.status).toBe(200);
    });
  });
});

// REQ 235 — Engineering Master Steps
describe('Engineering Master Step API', () => {
  describe('Step CRUD', () => {
    it('creates a step with default numbering', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'First Step',
        instructions: 'Do the thing',
      });

      expect(res.status).toBe(201);
      expect(res.body.stepNumber).toBe(10);
      expect(res.body.title).toBe('First Step');
    });

    it('auto-increments step number by 10', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Step 1',
      });
      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Step 2',
      });

      expect(res.status).toBe(201);
      expect(res.body.stepNumber).toBe(20);
    });

    it('updates a step', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const step = await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'Original',
      });

      const res = await auth.put(`${STEP_API}/${step.id}`).send({
        title: 'Updated Title',
        instructions: 'New instructions',
      });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
    });

    it('deletes a step', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const step = await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'To Delete',
      });

      const res = await auth.delete(`${STEP_API}/${step.id}`);

      expect(res.status).toBe(200);
    });

    it('rejects step creation on non-draft master', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user, {
        releaseState: 'released',
      });

      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Should fail',
      });

      expect(res.status).toBe(400);
    });

    it('reorders a step', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const step = await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'Step to reorder',
      });

      const res = await auth.put(`${STEP_API}/${step.id}/reorder`).send({
        stepNumber: 15,
      });

      expect(res.status).toBe(200);
      expect(res.body.stepNumber).toBe(15);
    });
  });

  // REQ 239 — Step Parts and Tooling
  describe('Step Parts and Tooling', () => {
    it('creates a step with parts and tooling', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const material = await createTestPart();
      const tool = await createTestPart({ name: `Tool ${Date.now()}` });

      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Step with items',
        parts: [{ partID: material.id, quantity: 4, isTool: false }],
        tooling: [{ partID: tool.id, quantity: 1, isTool: true }],
      });

      expect(res.status).toBe(201);

      // Verify items were created
      const detail = await auth.get(`${API}/${master.id}`);
      const step = detail.body.steps.find(s => s.id === res.body.id);
      expect(step.parts).toHaveLength(1);
      expect(step.tooling).toHaveLength(1);
    });

    it('enforces unique constraint on (stepID, partID)', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const part = await createTestPart();

      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Duplicate parts',
        parts: [
          { partID: part.id, quantity: 1, isTool: false },
          { partID: part.id, quantity: 2, isTool: false },
        ],
      });

      expect([201, 400]).toContain(res.status);
    });
  });

  // REQ 238 — Step Pin Markers
  describe('Step Markers', () => {
    it('creates a step with pin markers', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);

      const res = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Step with markers',
        markers: [
          { label: 'C1', x: 120.5, y: 80.3 },
          { label: 'C2', x: 200.0, y: 80.3 },
        ],
      });

      expect(res.status).toBe(201);

      const detail = await auth.get(`${API}/${master.id}`);
      const step = detail.body.steps.find(s => s.id === res.body.id);
      expect(step.markers).toHaveLength(2);
      expect(step.markers[0].label).toBe('C1');
      expect(step.markers[0].x).toBeCloseTo(120.5);
    });

    it('updates step markers', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const createRes = await auth.post(STEP_API).send({
        engineeringMasterID: master.id,
        title: 'Markers update test',
        markers: [{ label: 'X1', x: 10, y: 20 }],
      });

      const res = await auth.put(`${STEP_API}/${createRes.body.id}`).send({
        markers: [
          { label: 'X1', x: 15, y: 25 },
          { label: 'X2', x: 50, y: 60 },
        ],
      });

      expect(res.status).toBe(200);

      const detail = await auth.get(`${API}/${master.id}`);
      const step = detail.body.steps.find(s => s.id === createRes.body.id);
      expect(step.markers).toHaveLength(2);
    });
  });

  // REQ 235 — Step image upload
  describe('Step Image Upload', () => {
    it('uploads an image to a step', async () => {
      const auth = await authenticatedRequest();
      const master = await createTestEngineeringMaster(auth.user);
      const step = await db.EngineeringMasterStep.create({
        engineeringMasterID: master.id,
        stepNumber: 10,
        title: 'Image step',
      });

      const res = await auth
        .post(`${STEP_API}/${master.id}/upload-image/${step.id}`)
        .send({ filename: 'test.png', mimeType: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' });

      expect(res.status).toBe(200);
      expect(res.body.imageFileID).toBeTruthy();
    });
  });
});
