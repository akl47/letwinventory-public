// REQ 932 — export, measure, and section-view e2e. Builds one cube, then
// exercises body color, STL/STEP/3MF downloads (non-empty payloads), the measure sidebar,
// and the part section toggle.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import {
  createFixturePart, openEditor, enterSketchOnXY, drawClosedRectangle,
  extrudeSketch, openFileTab,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('export');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

test('build the cube fixture and release it (downloads serve the frozen release)', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  await drawClosedRectangle(page, 60);
  await extrudeSketch(page, 12);

  // REQ 1041 — color the body (persisted on the working copy, tints its row).
  const bodyRow = page.locator('li[data-testid^="body-"]').first();
  await bodyRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-body-color"]').click();
  await page.locator('[data-testid="body-swatch-e53935"]').click();
  await expect(bodyRow.locator('mat-icon.kind-icon')).toHaveCSS('color', 'rgb(229, 57, 53)');
  await page.waitForTimeout(1_000);  // past the 500 ms save debounce

  // Check in + release: the STL/STEP buttons only exist on a released model.
  await openFileTab(page);
  await page.locator('[data-testid="action-checkin"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('e2e: export fixture');
  await dialog.getByRole('button', { name: /check in/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  const release = page.locator('[data-testid="action-release-main"]');
  await expect(release).toBeEnabled({ timeout: 15_000 });
  await release.click();
  const confirm = page.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.getByRole('button', { name: /release|ok|confirm/i }).click();
  }
  await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText(/main/i, { timeout: 20_000 });
});

test('STL export downloads a non-empty binary', async ({ page }) => {
  await openEditor(page, PART_ID);
  await openFileTab(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-dl-stl"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.stl$/i);
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(84);  // binary STL header + at least one facet
});

test('STEP export downloads a non-empty file', async ({ page }) => {
  await openEditor(page, PART_ID);
  await openFileTab(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-dl-step"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ste?p$/i);
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString('utf8');
  expect(text).toContain('ISO-10303');
});

// REQ 1042 — 3MF carries the body as one object with its color as a filament.
test('3MF export downloads a package with the body color', async ({ page }) => {
  await openEditor(page, PART_ID);
  await openFileTab(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-dl-3mf"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.3mf$/i);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const model = await zip.file('3D/3dmodel.model')!.async('string');
  expect(model.match(/<item objectid=/g)).toHaveLength(1);
  const settings = JSON.parse(await zip.file('Metadata/project_settings.config')!.async('string'));
  expect(settings.filament_colour).toEqual(['#E53935']);
});

test('measure sidebar reports an edge length', async ({ page }) => {
  await openEditor(page, PART_ID);
  await page.locator('[data-testid="tab-tools"]').click();
  await page.locator('[data-testid="action-measure"]').click();
  await expect(page.locator('[data-testid="measure-sidebar"]')).toBeVisible({ timeout: 5_000 });
  // Pick a body edge programmatically (same entry point as a canvas click).
  const picked = await page.evaluate(() => {
    const g = (window as any).__cadApp?.geometry;
    const e = (g?.topology?.edges ?? [])[0];
    if (!e) return false;
    return (window as any).__cadPickEdge(e.id);
  });
  expect(picked).toBe(true);
  await expect(page.locator('[data-testid="measure-result-row"]').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="measure-close"]').click();
});

test('section view toggles without breaking the viewer', async ({ page }) => {
  await openEditor(page, PART_ID);
  await page.locator('[data-testid="tab-visualize"]').click();
  const toggle = page.locator('[data-testid="part-section-toggle"]');
  await toggle.click();
  // Section view stays interactive: the HUD keeps rendering and the toggle
  // flips back cleanly.
  await expect(page.locator('[data-testid="cad-hud-ready"]')).toBeVisible();
  await toggle.click();
  await expect(page.locator('[data-testid="cad-hud-ready"]')).toBeVisible();
});
