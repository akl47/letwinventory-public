import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('displays settings page', async ({ page }) => {
    await page.goto('/#/settings');
    const settingsPage = page.locator('app-settings-page');
    await expect(settingsPage).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Part Edit - New', () => {
  test('displays new part form', async ({ page }) => {
    await page.goto('/#/parts/new');
    const editPage = page.locator('app-part-edit-page');
    await expect(editPage).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Bulk Upload', () => {
  test('displays bulk upload page', async ({ page }) => {
    await page.goto('/#/orders/bulk-upload');
    const uploadPage = page.locator('app-bulk-upload');
    await expect(uploadPage).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Harness Editor - New', () => {
  test('displays harness editor for new harness', async ({ page }) => {
    await page.goto('/#/harness/editor');
    const editorPage = page.locator('app-harness-page');
    await expect(editorPage).toBeVisible({ timeout: 10000 });
  });
});
