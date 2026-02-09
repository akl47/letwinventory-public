import { test, expect } from '@playwright/test';

test.describe('Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/orders');
  });

  test('displays orders table', async ({ page }) => {
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });

  test('has search input', async ({ page }) => {
    const search = page.locator('input[placeholder*="Search"], input[matInput]').first();
    await expect(search).toBeVisible();
  });

  test('has pagination controls', async ({ page }) => {
    const paginator = page.locator('mat-paginator');
    await expect(paginator).toBeVisible();
  });
});
