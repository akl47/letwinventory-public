import { test, expect } from '@playwright/test';

test.describe('Scheduled Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/scheduled-tasks');
  });

  test('displays scheduled tasks list view', async ({ page }) => {
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });

  test('has search input', async ({ page }) => {
    const search = page.locator('input[placeholder*="Search"], input[matInput]').first();
    await expect(search).toBeVisible();
  });
});
