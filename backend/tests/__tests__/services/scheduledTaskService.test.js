const { createTestUser } = require('../../setup');
const { createTestTaskList } = require('../../helpers');

// Import the service function directly
const { processScheduledTasks } = require('../../../services/scheduledTaskService');

describe('ScheduledTaskService', () => {
  describe('processScheduledTasks', () => {
    it('creates task when nextRunAt is in the past', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'Sched Service' });

      await db.ScheduledTask.create({
        name: 'Due Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(Date.now() - 60000), // 1 min ago
        activeFlag: true,
      });

      await processScheduledTasks();

      const tasks = await db.Task.findAll({ where: { taskListID: list.id } });
      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe('Due Task');
      expect(tasks[0].ownerUserID).toBe(user.id);
    });

    it('advances nextRunAt after processing', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'Advance List' });

      const scheduled = await db.ScheduledTask.create({
        name: 'Advance Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *', // daily at 9am
        nextRunAt: new Date(Date.now() - 60000),
        activeFlag: true,
      });

      await processScheduledTasks();

      const updated = await db.ScheduledTask.findByPk(scheduled.id);
      expect(updated.lastRunAt).toBeDefined();
      expect(new Date(updated.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('skips inactive scheduled tasks', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'Skip List' });

      await db.ScheduledTask.create({
        name: 'Inactive Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(Date.now() - 60000),
        activeFlag: false,
      });

      await processScheduledTasks();

      const tasks = await db.Task.findAll({ where: { taskListID: list.id } });
      expect(tasks.length).toBe(0);
    });

    it('skips tasks with future nextRunAt', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'Future List' });

      await db.ScheduledTask.create({
        name: 'Future Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(Date.now() + 3600000), // 1 hour from now
        activeFlag: true,
      });

      await processScheduledTasks();

      const tasks = await db.Task.findAll({ where: { taskListID: list.id } });
      expect(tasks.length).toBe(0);
    });

    it('calculates rank correctly', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'Rank List' });

      // Create existing task with rank 5000
      await db.Task.create({
        name: 'Existing',
        ownerUserID: user.id,
        taskListID: list.id,
        rank: 5000,
        activeFlag: true,
        doneFlag: false,
      });

      await db.ScheduledTask.create({
        name: 'Ranked Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(Date.now() - 60000),
        activeFlag: true,
      });

      await processScheduledTasks();

      const tasks = await db.Task.findAll({
        where: { taskListID: list.id, name: 'Ranked Task' },
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0].rank).toBe(6000); // 5000 + 1000
    });

    it('sets due date when dueDateOffsetHours is set', async () => {
      const user = await createTestUser();
      const list = await createTestTaskList({ name: 'DueDate List' });

      await db.ScheduledTask.create({
        name: 'Due Date Task',
        ownerUserID: user.id,
        taskListID: list.id,
        cronExpression: '0 9 * * *',
        nextRunAt: new Date(Date.now() - 60000),
        dueDateOffsetHours: 24,
        activeFlag: true,
      });

      await processScheduledTasks();

      const tasks = await db.Task.findAll({
        where: { taskListID: list.id, name: 'Due Date Task' },
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0].dueDate).toBeDefined();
      // Due date should be ~24 hours from now
      const dueTime = new Date(tasks[0].dueDate).getTime();
      expect(dueTime).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    });
  });
});
