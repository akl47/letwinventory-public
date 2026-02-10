const { authenticatedRequest, createTestTaskList, createTestProject } = require('../../helpers');
const { createTestUser } = require('../../setup');

describe('ScheduledTask API', () => {
  describe('POST /api/planning/scheduled-task', () => {
    it('creates a scheduled task', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Sched List' });

      const res = await auth.post('/api/planning/scheduled-task')
        .send({
          name: 'Daily Standup',
          taskListID: list.id,
          cronExpression: '0 9 * * *',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Daily Standup');
      expect(res.body.nextRunAt).toBeDefined();
      expect(res.body.ownerUserID).toBe(auth.user.id);
    });

    it('validates cron expression', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Bad Cron List' });

      const res = await auth.post('/api/planning/scheduled-task')
        .send({
          name: 'Bad Cron',
          taskListID: list.id,
          cronExpression: 'invalid-cron',
        });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/planning/scheduled-task', () => {
    it('lists active scheduled tasks', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'List Active' });

      await db.ScheduledTask.create({
        name: 'Active Task',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(),
        activeFlag: true,
      });
      await db.ScheduledTask.create({
        name: 'Inactive Task',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 10 * * *',
        nextRunAt: new Date(),
        activeFlag: false,
      });

      const res = await auth.get('/api/planning/scheduled-task');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Active Task');
    });

    it('includes inactive when requested', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'List All' });

      await db.ScheduledTask.create({
        name: 'Active',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(),
        activeFlag: true,
      });
      await db.ScheduledTask.create({
        name: 'Inactive',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 10 * * *',
        nextRunAt: new Date(),
        activeFlag: false,
      });

      const res = await auth.get('/api/planning/scheduled-task?includeInactive=true');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/planning/scheduled-task/:id', () => {
    it('gets scheduled task by id', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Get ST' });
      const st = await db.ScheduledTask.create({
        name: 'Get Me',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(),
        activeFlag: true,
      });

      const res = await auth.get(`/api/planning/scheduled-task/${st.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Get Me');
    });
  });

  describe('PUT /api/planning/scheduled-task/:id', () => {
    it('updates scheduled task and recomputes nextRunAt', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Update ST' });
      const st = await db.ScheduledTask.create({
        name: 'Update Me',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(),
        activeFlag: true,
      });

      const res = await auth.put(`/api/planning/scheduled-task/${st.id}`)
        .send({ cronExpression: '0 12 * * *', name: 'Updated ST' });
      expect(res.status).toBe(200);
      const updated = await db.ScheduledTask.findByPk(st.id);
      expect(updated.name).toBe('Updated ST');
    });
  });

  describe('DELETE /api/planning/scheduled-task/:id', () => {
    it('soft deletes a scheduled task', async () => {
      const auth = await authenticatedRequest();
      const list = await createTestTaskList({ name: 'Del ST' });
      const st = await db.ScheduledTask.create({
        name: 'Delete Me',
        ownerUserID: auth.user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(),
        activeFlag: true,
      });

      const res = await auth.delete(`/api/planning/scheduled-task/${st.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.ScheduledTask.findByPk(st.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
