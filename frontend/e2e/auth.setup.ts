import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page, request }) => {
  // Option 1: Use provided JWT token
  let token = process.env.E2E_AUTH_TOKEN;

  // Option 2: Get token from dev test-login endpoint
  if (!token) {
    const apiUrl = process.env.E2E_API_URL || `http://localhost:${process.env.E2E_PORT || 4201}/api`;
    try {
      const response = await request.post(`${apiUrl}/auth/google/test-login`, {
        data: { email: 'e2e@test.local', displayName: 'E2E Test User' },
      });
      if (response.ok()) {
        const body = await response.json();
        token = body.accessToken;
      }
    } catch {
      // Backend not available
    }
  }

  if (!token) {
    console.warn('No auth available. Set E2E_AUTH_TOKEN or run the backend dev server.');
    await page.goto('/');
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  // Navigate first so localStorage is bound to the correct origin
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Set token in localStorage
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
  }, token);

  // Verify token was stored
  const stored = await page.evaluate(() => localStorage.getItem('auth_token'));
  console.log('Token stored:', stored ? `${stored.substring(0, 20)}...` : 'FAILED');

  // Save state — must explicitly include origins for localStorage to persist
  const state = await page.context().storageState();
  console.log('Storage state origins:', JSON.stringify(state.origins));

  // If Playwright didn't capture localStorage, manually construct the state
  if (!state.origins.length || !state.origins.some(o => o.localStorage.length > 0)) {
    const baseURL = page.url().replace(/\/$/, '');
    const origin = new URL(baseURL).origin;
    state.origins = [{
      origin,
      localStorage: [{ name: 'auth_token', value: token }],
    }];
  }

  const fs = await import('fs');
  const path = await import('path');
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
});
