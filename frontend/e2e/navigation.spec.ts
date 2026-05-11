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
  // The shared <app-data-table> renders an absolutely-positioned overlay
  // anchor inside each row's first cell, so middle-click opens via the
  // browser's native anchor behaviour (popup -> navigation), not a sync
  // window.open. Wait for the popup to navigate past about:blank before
  // asserting the URL.
  async function expectMiddleClickOpens(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, route: string, urlFragment: string) {
    await page.goto(route);
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    const row = page.locator('tr.clickable-row, tr[mat-row]').first();
    if (await row.count() === 0) return;

    const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await row.click({ button: 'middle' });
    const newPage = await newPagePromise;
    if (!newPage) return;

    await newPage.waitForURL((url) => url.toString().includes(urlFragment), { timeout: 5000 });
    expect(newPage.url()).toContain(urlFragment);
    await newPage.close();
  }

  test('parts table row middle-click opens new tab', async ({ page, context }) => {
    await expectMiddleClickOpens(page, context, '/#/parts', '/parts/');
  });

  test('orders table row middle-click opens new tab', async ({ page, context }) => {
    await expectMiddleClickOpens(page, context, '/#/orders', '/orders/');
  });

  test('harness table row middle-click opens new tab', async ({ page, context }) => {
    await expectMiddleClickOpens(page, context, '/#/harness', '/harness/');
  });
});
