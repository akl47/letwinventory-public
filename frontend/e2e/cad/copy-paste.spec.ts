// REQ 1011–1013 — whole-part copy: export a part as .lwcad, import it on the
// CAD landing page as a NEW part, and paste a copied part via a paste event.
import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  createFixturePart, openEditor, enterSketchOnXY, drawClosedRectangle,
  extrudeSketch, openFileTab, featureRows, geometrySummary,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;
let lwcadPath = '';
let lwcadText = '';
let sourceRows = 0;
let sourceFaces = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('copy');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

async function pasteText(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, text);
}

async function createFromDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Paste part')).toBeVisible();
  // Defaults to this environment's next part number, not the source's.
  await expect(dialog.locator('[data-testid="npd-name"]')).toHaveValue(/^\d{6,}$/);
  await dialog.locator('[data-testid="npd-create"]').click();
  await page.waitForURL(/\/parts\/\d+\/cad\/editor/, { timeout: 20_000 });
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
}

test('build the source part and export it as .lwcad', async ({ page }, info) => {
  test.setTimeout(180_000);
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  await drawClosedRectangle(page, 60);
  await extrudeSketch(page, 12);
  sourceRows = await featureRows(page).count();
  await expect.poll(async () => (await geometrySummary(page))?.faces ?? 0).toBeGreaterThan(0);
  sourceFaces = (await geometrySummary(page))!.faces;

  await openFileTab(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-export-part"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^E2E CAD copy .*-.*\.lwcad$/);
  lwcadPath = info.outputPath('part.lwcad');
  await download.saveAs(lwcadPath);
  lwcadText = readFileSync(lwcadPath, 'utf8');
  const bundle = JSON.parse(lwcadText);
  expect(bundle).toMatchObject({ kind: 'letwinventory-cad', schema: 1, scope: 'part' });
});

test('Import part creates a new part with the same geometry', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/design/cad');
  await page.locator('[data-testid="cad-import-part"]').waitFor();
  await page.locator('[data-testid="cad-import-file"]').setInputFiles(lwcadPath);
  await createFromDialog(page);
  expect(page.url()).not.toContain(`/parts/${PART_ID}/`);
  await expect(featureRows(page)).toHaveCount(sourceRows, { timeout: 20_000 });
  await expect.poll(async () => (await geometrySummary(page))?.faces ?? 0, { timeout: 30_000 }).toBe(sourceFaces);
});

test('pasting a copied part on the landing page opens Paste part; other text is ignored', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/design/cad');
  await page.locator('[data-testid="cad-import-part"]').waitFor();
  await pasteText(page, 'just some text');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await pasteText(page, lwcadText);
  await createFromDialog(page);
  await expect(featureRows(page)).toHaveCount(sourceRows, { timeout: 20_000 });
});
