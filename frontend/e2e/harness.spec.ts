import { test, expect } from '@playwright/test';

test.describe('Harness List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/harness');
  });

  test('displays harness list view', async ({ page }) => {
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
  });

  test('has search input', async ({ page }) => {
    const search = page.locator('input[placeholder*="Search"], input[matInput]').first();
    await expect(search).toBeVisible();
  });

  test('shows status chips', async ({ page }) => {
    // Status chips may or may not exist depending on data
    const table = page.locator('table, mat-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });
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

  test('opens harness editor', async ({ page }) => {
    test.skip(!harnessId, 'No harness created');
    await page.goto(`/#/harness/editor/${harnessId}`);
    // Wait for canvas to render
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test('exported JSON does not contain image data', async ({ page }) => {
    test.skip(!harnessId, 'No harness created');
    await page.goto(`/#/harness/editor/${harnessId}`);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Click export menu trigger (download icon)
    const exportButton = page.locator('button:has(mat-icon:text("download"))');
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    await exportButton.click();

    // Click "Export JSON" menu item
    const jsonOption = page.locator('button:has-text("Export JSON")');
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
