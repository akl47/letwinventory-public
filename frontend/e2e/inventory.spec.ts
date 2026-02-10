import { test, expect } from '@playwright/test';

test.describe('Inventory', () => {
  test('displays inventory hierarchy view', async ({ page }) => {
    await page.goto('/#/inventory');
    // The hierarchy view should load
    const view = page.locator('app-inventory-higherarchy-view');
    await expect(view).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Parts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/parts');
  });

  test('displays parts table', async ({ page }) => {
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

test.describe('Equipment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/equipment');
  });

  test('displays equipment table', async ({ page }) => {
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });
});
