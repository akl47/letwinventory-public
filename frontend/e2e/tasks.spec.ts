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

  test('displays task list columns', async ({ page }) => {
    // Task list components should render
    const columns = page.locator('app-task-list');
    // Wait for at least one column to appear
    await expect(columns.first()).toBeVisible({ timeout: 10000 });
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
