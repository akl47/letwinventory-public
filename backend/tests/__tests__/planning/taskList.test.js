const { authenticatedRequest, createTestTaskList } = require('../../helpers');

describe('TaskList API', () => {
  describe('GET /api/planning/tasklist', () => {
    it('lists all task lists with tasks', async () => {
      const auth = await authenticatedRequest();
      await createTestTaskList({ name: 'Backlog', order: 0 });
      await createTestTaskList({ name: 'In Progress', order: 1 });

      const res = await auth.get('/api/planning/tasklist');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('returns lists ordered by order column', async () => {
      const auth = await authenticatedRequest();
      await createTestTaskList({ name: 'Second', order: 2 });
      await createTestTaskList({ name: 'First', order: 1 });

      const res = await auth.get('/api/planning/tasklist');
      expect(res.status).toBe(200);
      expect(res.body[0].name).toBe('First');
      expect(res.body[1].name).toBe('Second');
    });
  });

  describe('GET /api/planning/tasklist/:id', () => {
    it('gets task list by id', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Get List' });
      const res = await auth.get(`/api/planning/tasklist/${list.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Get List');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/planning/tasklist/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/planning/tasklist', () => {
    it('creates a task list with auto order', async () => {
      const auth = await authenticatedRequest();
      await createTestTaskList({ name: 'Existing', order: 0 });

      const res = await auth.post('/api/planning/tasklist')
        .send({ name: 'New List' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('New List');
      expect(res.body.order).toBe(1);
    });
  });

  describe('PUT /api/planning/tasklist/:id', () => {
    it('updates a task list', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Update List' });
      const res = await auth.put(`/api/planning/tasklist/${list.id}`)
        .send({ name: 'Updated List' });
      expect(res.status).toBe(200);
      const updated = await db.TaskList.findByPk(list.id);
      expect(updated.name).toBe('Updated List');
    });
  });

  describe('PUT /api/planning/tasklist/reorder', () => {
    it('reorders task lists', async () => {
      const auth = await authenticatedRequest();
      const l1 = await createTestTaskList({ name: 'L1', order: 0 });
      const l2 = await createTestTaskList({ name: 'L2', order: 1 });
      const l3 = await createTestTaskList({ name: 'L3', order: 2 });

      const res = await auth.put('/api/planning/tasklist/reorder')
        .send({ orderedIds: [l3.id, l1.id, l2.id] });
      expect(res.status).toBe(200);

      const updated1 = await db.TaskList.findByPk(l1.id);
      const updated3 = await db.TaskList.findByPk(l3.id);
      expect(updated3.order).toBe(0);
      expect(updated1.order).toBe(1);
    });
  });

  describe('DELETE /api/planning/tasklist/:id', () => {
    it('soft deletes a task list', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Del List' });
      const res = await auth.delete(`/api/planning/tasklist/${list.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.TaskList.findByPk(list.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
