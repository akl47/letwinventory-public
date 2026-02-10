const { authenticatedRequest, createTestTask, createTestTaskList } = require('../../helpers');
const { createTestUser } = require('../../setup');

describe('TaskHistory API', () => {
  describe('GET /api/planning/taskhistory', () => {
    it('lists all task history', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Hist List' });
      const task = await createTestTask(auth.user, { taskListID: list.id });

      // Create via API to auto-generate history
      await auth.post('/api/planning/task')
        .send({ name: 'History Task', taskListID: list.id });

      const res = await auth.get('/api/planning/taskhistory');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/planning/taskhistory/actiontypes', () => {
    it('lists action types', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/planning/taskhistory/actiontypes');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(5);
      expect(res.body.find(a => a.code === 'CREATED')).toBeDefined();
      expect(res.body.find(a => a.code === 'MOVE_LIST')).toBeDefined();
    });
  });

  describe('GET /api/planning/taskhistory/task/:taskId', () => {
    it('gets history for a specific task', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Task Hist' });

      // Create task via API to generate CREATED history
      const createRes = await auth.post('/api/planning/task')
        .send({ name: 'Tracked Task', taskListID: list.id });

      const res = await auth.get(`/api/planning/taskhistory/task/${createRes.body.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for task with no history', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user);
      const res = await auth.get(`/api/planning/taskhistory/task/${task.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
