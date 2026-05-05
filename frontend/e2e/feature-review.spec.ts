import { test, expect } from '@playwright/test';

test.describe('Feature Review', () => {
  test('list view loads at /features', async ({ page }) => {
    await page.goto('/#/features');
    const table = page.locator('table, mat-table, .feature-list');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });

  test('new feature page is reachable from list', async ({ page }) => {
    await page.goto('/#/features');
    const newButton = page.locator('a, button').filter({ hasText: /new feature|create/i }).first();
    await expect(newButton).toBeVisible({ timeout: 10000 });
  });

  test('full lifecycle: create draft → submit → approve → release', async ({ page }) => {
    const slug = `e2e-feature-${Date.now()}`;
    await page.goto('/#/features/new');

    // Fill name and submit. The page should navigate to /features/:id/edit.
    await page.locator('[data-test="input-name"], input[name="name"]').first().fill('E2E Feature');
    // Pick a project — assume the first option works.
    const projectSelect = page.locator('mat-select, [data-test="select-project"]').first();
    if (await projectSelect.isVisible()) {
      await projectSelect.click();
      await page.locator('mat-option').first().click();
    }
    await page.locator('[data-test="submit"], button[type="submit"]').first().click();

    // Wait for the edit page (URL contains /edit).
    await page.waitForURL(/\/features\/\d+\/edit/, { timeout: 10000 });

    // Submit for review.
    const submit = page.locator('[data-test="action-submit"]');
    await expect(submit).toBeVisible();
    await submit.click();

    // State badge updates.
    await expect(page.locator('[data-test="state-badge"]')).toContainText(/in.review/i);

    // Approve.
    const approve = page.locator('[data-test="action-approve"]');
    await approve.click();
    await expect(page.locator('[data-test="state-badge"]')).toContainText(/approved/i);

    // Release.
    const release = page.locator('[data-test="action-release"]');
    await release.click();
    await expect(page.locator('[data-test="state-badge"]')).toContainText(/released/i);

    // Read-only banner is shown.
    await expect(page.locator('[data-test="readonly-banner"]')).toBeVisible();
  });
});
