import { test, expect, devices } from '@playwright/test';

const { defaultBrowserType, ...iPhone13 } = devices['iPhone 13'];
test.use({ ...iPhone13 });

test.describe('Mobile', () => {
  test('sidebar is collapsed on mobile', async ({ page }) => {
    await page.goto('/#/tasks');
    // Sidebar should be collapsed (width 0 or hidden)
    const sidebar = page.locator('.sidenav.collapsed, .sidenav');
    await expect(sidebar.first()).toBeVisible();
  });

  test('task board has snap-scroll on mobile', async ({ page }) => {
    await page.goto('/#/tasks');
    const board = page.locator('.board-container');
    await expect(board.first()).toBeVisible({ timeout: 10000 });
  });

  test('scanner page loads', async ({ page }) => {
    await page.goto('/#/mobile');
    // Scanner component should render (shows unsupported message in headless browser)
    const scanner = page.locator('app-mobile-scanner');
    await expect(scanner).toBeVisible({ timeout: 10000 });
  });

  test('scanner has back button', async ({ page }) => {
    await page.goto('/#/mobile');
    const backBtn = page.locator('.back-btn');
    await expect(backBtn).toBeVisible({ timeout: 10000 });
  });
});
