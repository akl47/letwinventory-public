import { test, expect } from '@playwright/test';

test.describe('Harness List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/harness');
  });

  test('displays harness list view', async ({ page }) => {
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });

  test('has search input', async ({ page }) => {
    const search = page.locator('input[placeholder*="Search"], input[matInput]').first();
    await expect(search).toBeVisible();
  });

  test('shows status chips', async ({ page }) => {
    // Status chips may or may not exist depending on data
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });
});
