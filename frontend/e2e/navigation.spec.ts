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
