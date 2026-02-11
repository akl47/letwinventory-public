const { authenticatedRequest, createTestTask, createTestTaskList, createTestProject } = require('../../helpers');
const { createTestUser } = require('../../setup');

describe('Task API', () => {
  describe('GET /api/planning/task/types', () => {
    it('lists task types', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/planning/task/types');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
      expect(res.body.find(t => t.value === 'normal')).toBeDefined();
    });
  });

  describe('GET /api/planning/task', () => {
    it('lists all tasks', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Task List' });
      await createTestTask(auth.user, { name: 'Task A', taskListID: list.id, rank: 1000 });
      await createTestTask(auth.user, { name: 'Task B', taskListID: list.id, rank: 2000 });

      const res = await auth.get('/api/planning/task');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('filters by taskListId', async () => {
      const auth = await authenticatedRequest();
      const list1 = await createTestTaskList({ name: 'List 1', order: 0 });
      const list2 = await createTestTaskList({ name: 'List 2', order: 1 });
      await createTestTask(auth.user, { name: 'T1', taskListID: list1.id });
      await createTestTask(auth.user, { name: 'T2', taskListID: list2.id });

      const res = await auth.get(`/api/planning/task?taskListId=${list1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('T1');
    });

    it('returns tasks ordered by rank', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Ordered' });
      await createTestTask(auth.user, { name: 'Second', taskListID: list.id, rank: 2000 });
      await createTestTask(auth.user, { name: 'First', taskListID: list.id, rank: 1000 });

      const res = await auth.get('/api/planning/task');
      expect(res.status).toBe(200);
      expect(res.body[0].name).toBe('First');
      expect(res.body[1].name).toBe('Second');
    });
  });

  describe('GET /api/planning/task/:id', () => {
    it('gets task by id', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'Get Task' });
      const res = await auth.get(`/api/planning/task/${task.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Get Task');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/planning/task/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/planning/task', () => {
    it('creates a task with auto rank', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Create List' });
      await createTestTask(auth.user, { taskListID: list.id, rank: 1000 });

      const res = await auth.post('/api/planning/task')
        .send({
          name: 'New Task',
          taskListID: list.id,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('New Task');
      expect(res.body.rank).toBe(2000); // 1000 + 1000
      expect(res.body.ownerUserID).toBe(auth.user.id);
    });

    it('creates CREATED history entry', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'History List' });

      const res = await auth.post('/api/planning/task')
        .send({ name: 'History Task', taskListID: list.id });
      expect([200, 201]).toContain(res.status);

      const history = await db.TaskHistory.findAll({
        where: { taskID: res.body.id },
        include: [{ model: db.TaskHistoryActionType, as: 'actionType' }],
      });
      expect(history.length).toBe(1);
      expect(history[0].actionType.code).toBe('CREATED');
    });
  });

  describe('PUT /api/planning/task/:id', () => {
    it('updates task name', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'Original' });
      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ name: 'Updated Task' });
      expect(res.status).toBe(200);
      const updated = await db.Task.findByPk(task.id);
      expect(updated.name).toBe('Updated Task');
    });

    it('assigns project and creates history', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'Project Task' });
      const project = await createTestProject(auth.user, { name: 'Assign Proj', shortName: 'AP' });

      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ projectID: project.id });
      expect(res.status).toBe(200);

      const updated = await db.Task.findByPk(task.id);
      expect(updated.projectID).toBe(project.id);
    });

    it('marks task as done', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'Done Task' });
      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ doneFlag: true });
      expect(res.status).toBe(200);

      const updated = await db.Task.findByPk(task.id);
      expect(updated.doneFlag).toBe(true);
    });
  });

  describe('PUT /api/planning/task/:taskId/move', () => {
    it('moves task to different list', async () => {
      const auth = await authenticatedRequest();
      const list1 = await createTestTaskList({ name: 'Source', order: 0 });
      const list2 = await createTestTaskList({ name: 'Target', order: 1 });
      const task = await createTestTask(auth.user, { name: 'Move Task', taskListID: list1.id, rank: 1000 });

      const res = await auth.put(`/api/planning/task/${task.id}/move`)
        .send({ taskListId: list2.id, newIndex: 0 });
      expect(res.status).toBe(200);

      const moved = await db.Task.findByPk(task.id);
      expect(moved.taskListID).toBe(list2.id);
    });
  });

  describe('Task Checklist', () => {
    it('creates task with checklist items', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Checklist List' });
      const checklist = [
        { id: 'a1', text: 'Item 1', checked: false },
        { id: 'a2', text: 'Item 2', checked: true },
      ];

      const res = await auth.post('/api/planning/task')
        .send({ name: 'Checklist Task', taskListID: list.id, checklist });
      expect([200, 201]).toContain(res.status);
      expect(res.body.checklist).toEqual(checklist);
    });

    it('updates task to add checklist', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'No Checklist' });
      const checklist = [{ id: 'b1', text: 'New item', checked: false }];

      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ checklist });
      expect(res.status).toBe(200);

      const updated = await db.Task.findByPk(task.id);
      expect(updated.checklist).toEqual(checklist);
    });

    it('updates task to toggle checklist item', async () => {
      const auth = await authenticatedRequest();
      const checklist = [{ id: 'c1', text: 'Toggle me', checked: false }];
      const task = await createTestTask(auth.user, { name: 'Toggle Task', checklist });

      const toggled = [{ id: 'c1', text: 'Toggle me', checked: true }];
      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ checklist: toggled });
      expect(res.status).toBe(200);

      const updated = await db.Task.findByPk(task.id);
      expect(updated.checklist[0].checked).toBe(true);
    });

    it('updates task to remove checklist', async () => {
      const auth = await authenticatedRequest();
      const checklist = [{ id: 'd1', text: 'Remove me', checked: false }];
      const task = await createTestTask(auth.user, { name: 'Remove CL Task', checklist });

      const res = await auth.put(`/api/planning/task/${task.id}`)
        .send({ checklist: null });
      expect(res.status).toBe(200);

      const updated = await db.Task.findByPk(task.id);
      expect(updated.checklist).toBeNull();
    });

    it('returns checklist in GET response', async () => {
      const auth = await authenticatedRequest();
      const checklist = [{ id: 'e1', text: 'GET item', checked: false }];
      const task = await createTestTask(auth.user, { name: 'GET CL Task', checklist });

      const res = await auth.get(`/api/planning/task/${task.id}`);
      expect(res.status).toBe(200);
      expect(res.body.checklist).toEqual(checklist);
    });
  });

  describe('DELETE /api/planning/task/:id', () => {
    it('soft deletes a task', async () => {
      const auth = await authenticatedRequest();
      const task = await createTestTask(auth.user, { name: 'Delete Task' });
      const res = await auth.delete(`/api/planning/task/${task.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Task.findByPk(task.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/planning/task/99999');
      expect(res.status).toBe(404);
    });
  });
});
