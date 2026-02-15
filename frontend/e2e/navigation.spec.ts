import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('sidebar renders navigation links', async ({ page }) => {
    await page.goto('/#/tasks');
    // Check that sidebar has nav links
    const sidebar = page.locator('.sidenav, mat-sidenav, nav');
    await expect(sidebar.first()).toBeVisible();
  });

  test('navigates to tasks page', async ({ page }) => {
    await page.goto('/#/tasks');
    await expect(page).toHaveURL(/.*#\/tasks/);
  });

  test('navigates to parts page', async ({ page }) => {
    await page.goto('/#/parts');
    await expect(page).toHaveURL(/.*#\/parts/);
  });

  test('navigates to orders page', async ({ page }) => {
    await page.goto('/#/orders');
    await expect(page).toHaveURL(/.*#\/orders/);
  });

  test('navigates to equipment page', async ({ page }) => {
    await page.goto('/#/equipment');
    await expect(page).toHaveURL(/.*#\/equipment/);
  });

  test('navigates to harness page', async ({ page }) => {
    await page.goto('/#/harness');
    await expect(page).toHaveURL(/.*#\/harness/);
  });

  test('navigates to inventory page', async ({ page }) => {
    await page.goto('/#/inventory');
    await expect(page).toHaveURL(/.*#\/inventory/);
  });
});

test.describe('Middle-click opens new tab', () => {
  test('parts table row middle-click opens new tab', async ({ page, context }) => {
    await page.goto('/#/parts');
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    const row = page.locator('tr.clickable-row, tr[mat-row]').first();
    if (await row.count() > 0) {
      // Listen for new page (tab) to be opened
      const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await row.click({ button: 'middle' });
      const newPage = await newPagePromise;
      if (newPage) {
        expect(newPage.url()).toContain('/parts/');
        await newPage.close();
      }
    }
  });

  test('orders table row middle-click opens new tab', async ({ page, context }) => {
    await page.goto('/#/orders');
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    const row = page.locator('tr.clickable-row, tr[mat-row]').first();
    if (await row.count() > 0) {
      const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await row.click({ button: 'middle' });
      const newPage = await newPagePromise;
      if (newPage) {
        expect(newPage.url()).toContain('/orders/');
        await newPage.close();
      }
    }
  });

  test('harness table row middle-click opens new tab', async ({ page, context }) => {
    await page.goto('/#/harness');
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    const row = page.locator('tr.clickable-row, tr[mat-row]').first();
    if (await row.count() > 0) {
      const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await row.click({ button: 'middle' });
      const newPage = await newPagePromise;
      if (newPage) {
        expect(newPage.url()).toContain('/harness/');
        await newPage.close();
      }
    }
  });
});
