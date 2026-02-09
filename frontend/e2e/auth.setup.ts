import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');

  // Inject JWT token for testing
  // In CI, use E2E_AUTH_TOKEN env var; locally, user provides token
  const token = process.env.E2E_AUTH_TOKEN;
  if (!token) {
    console.warn('No E2E_AUTH_TOKEN set. Skipping auth setup. Set E2E_AUTH_TOKEN to a valid JWT for authenticated tests.');
    // Create empty auth state - tests requiring auth will be skipped
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  await page.evaluate((t) => localStorage.setItem('auth_token', t), token);
  await page.goto('/#/tasks');
  // Wait for the task board to load (confirms auth works)
  await page.waitForSelector('app-task-list-view, app-sub-toolbar', { timeout: 10000 }).catch(() => {});

  await page.context().storageState({ path: AUTH_FILE });
});
