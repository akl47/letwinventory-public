import { test, expect } from '@playwright/test';

// REQ 1068 — harnesses are opened from the CAD landing page.
test.describe('Harness List', () => {
  test('the old harness list address leads to the CAD landing page', async ({ page }) => {
    await page.goto('/#/harness');
    await expect(page.locator('[data-testid="cad-landing"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="cad-new-harness"]')).toBeVisible();
  });
});

test.describe('Harness Editor', () => {
  let harnessId: number;

  test.beforeEach(async ({ page, request }) => {
    // Navigate first so localStorage is accessible
    await page.goto('/#/harness');
    const apiUrl = `http://localhost:${process.env.E2E_PORT || 4201}/api`;
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));

    const res = await request.post(`${apiUrl}/parts/harness`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `E2E Test Harness ${Date.now()}`,
        revision: 'A',
        harnessData: {
          name: 'E2E Test Harness',
          connectors: [
            {
              id: 'c1', label: 'J1', type: 'male', pinCount: 2,
              pins: [{ id: 'p1', number: '1' }, { id: 'p2', number: '2' }],
              position: { x: 100, y: 100 },
              showConnectorImage: true,
              connectorImage: 'data:image/png;base64,SHOULD_BE_STRIPPED'
            }
          ],
          cables: [],
          components: [],
          connections: []
        }
      }
    });

    if (res.ok()) {
      const body = await res.json();
      harnessId = body.id;
    }
  });

  // REQ 1067 — the harness opens in the CAD editor shell, in harness mode.
  test('opens harness editor', async ({ page }) => {
    test.skip(!harnessId, 'No harness created');
    await page.goto(`/#/harness/editor/${harnessId}`);
    await expect(page.locator('[data-testid="cad-editor"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-harness-canvas canvas').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="tab-harness"]')).toBeVisible();
    await expect(page.locator('[data-testid="harness-rail"]')).toBeVisible();
    await expect(page.locator(`[data-testid="cad-harness-tab-${harnessId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="revision-badge"]')).toContainText('Rev 01*');
    // Read-only until checked out
    await expect(page.locator('[data-testid="tool-wire"]')).toBeDisabled();
    await page.locator('[data-testid="tab-file"]').click();
    await page.locator('[data-testid="action-checkout"]').click();
    await page.locator('[data-testid="tab-harness"]').click();
    await expect(page.locator('[data-testid="tool-wire"]')).toBeEnabled({ timeout: 10000 });
  });

  test('exported JSON does not contain image data', async ({ page }) => {
    test.skip(!harnessId, 'No harness created');
    await page.goto(`/#/harness/editor/${harnessId}`);

    const canvas = page.locator('app-harness-canvas canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Export lives on the ribbon's File tab
    const fileTab = page.locator('[data-testid="tab-file"]');
    await expect(fileTab).toBeVisible({ timeout: 5000 });
    await fileTab.click();

    // Click the "Export JSON" ribbon button
    const jsonOption = page.locator('[data-testid="action-export-json"]');
    await expect(jsonOption).toBeVisible({ timeout: 5000 });

    // Listen for download event before clicking
    const downloadPromise = page.waitForEvent('download');
    await jsonOption.click();
    const download = await downloadPromise;

    // Read the downloaded file
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const content = require('fs').readFileSync(filePath!, 'utf-8');
    const json = JSON.parse(content);

    // Verify image data fields are not present
    for (const conn of json.connectors || []) {
      expect(conn.connectorImage).toBeUndefined();
      expect(conn.pinoutDiagramImage).toBeUndefined();
    }
    for (const cable of json.cables || []) {
      expect(cable.cableDiagramImage).toBeUndefined();
    }
    for (const comp of json.components || []) {
      expect(comp.componentImage).toBeUndefined();
      expect(comp.pinoutDiagramImage).toBeUndefined();
    }
    // Show flags should be preserved
    if (json.connectors?.length > 0) {
      expect(json.connectors[0].showConnectorImage).toBe(true);
    }
  });

  test.afterEach(async ({ request, page }) => {
    // Clean up test harness
    if (harnessId) {
      const apiUrl = `http://localhost:${process.env.E2E_PORT || 4201}/api`;
      const token = await page.evaluate(() => localStorage.getItem('auth_token'));
      await request.delete(`${apiUrl}/parts/harness/${harnessId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  });
});
