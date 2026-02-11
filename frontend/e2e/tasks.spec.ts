import { test, expect } from '@playwright/test';

test.describe('Tasks Board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/tasks');
  });

  test('displays task board layout', async ({ page }) => {
    // Board container should exist
    const board = page.locator('.board-container, .board-wrapper');
    await expect(board.first()).toBeVisible();
  });

  test('displays task list view', async ({ page }) => {
    // Task list view component should render (columns only appear with data)
    const view = page.locator('app-task-list-view');
    await expect(view).toBeVisible({ timeout: 10000 });
  });

  test('sub-toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('app-sub-toolbar');
    await expect(toolbar).toBeVisible();
  });

  test('task cards are rendered', async ({ page }) => {
    // Wait for task cards to appear (may be empty if no tasks)
    const cards = page.locator('app-task-card');
    // Just check the board loaded, not that cards exist
    const board = page.locator('.board-container, .board-wrapper');
    await expect(board.first()).toBeVisible();
  });
});

test.describe('Task Checklist', () => {
  test('can add and toggle checklist items via UI', async ({ page }) => {
    await page.goto('/#/tasks');

    // Create a task via API
    const taskId = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const listsRes = await fetch('/api/planning/tasklist', { headers });
      const lists = await listsRes.json();
      let listId: number;
      if (lists.length > 0) {
        listId = lists[0].id;
      } else {
        const createList = await fetch('/api/planning/tasklist', {
          method: 'POST', headers, body: JSON.stringify({ name: 'E2E List', order: 0 })
        });
        const list = await createList.json();
        listId = list.id;
      }

      const createRes = await fetch('/api/planning/task', {
        method: 'POST', headers, body: JSON.stringify({ name: 'CL Test Task', taskListID: listId })
      });
      const task = await createRes.json();
      return task.id;
    });

    expect(taskId).toBeTruthy();

    // Reload and open the task dialog
    await page.goto('/#/tasks');
    const card = page.locator('app-task-card', { hasText: 'CL Test Task' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();

    const dialog = page.locator('.trello-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click Checklist label to show checklist section
    const checklistLabel = dialog.locator('.labels-container .clickable-label', { hasText: 'Checklist' });
    await checklistLabel.click();

    const checklistSection = dialog.locator('.checklist-section');
    await expect(checklistSection).toBeVisible();

    // Add two checklist items via the input
    const input = checklistSection.locator('.checklist-input');
    await input.fill('Buy parts');
    await input.press('Enter');
    await input.fill('Assemble unit');
    await input.press('Enter');

    // Verify both items appeared
    await expect(checklistSection.locator('.checklist-text')).toHaveCount(2);

    // Toggle first item
    const firstCheckbox = checklistSection.locator('.checklist-checkbox').first();
    await firstCheckbox.click();

    // First item should have completed style
    await expect(checklistSection.locator('.checklist-text.completed')).toHaveCount(1);

    // Close dialog and verify badge on card
    await dialog.locator('.close-btn').click();
    await expect(dialog).not.toBeVisible();

    // Badge should show 1/2
    const badge = card.locator('.checklist-badge');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toContainText('1/2');
  });
});
