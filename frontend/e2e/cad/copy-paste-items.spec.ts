// REQ 1100–1102 — copy / paste of feature-tree items, within a part and into
// another part. The clipboard text is captured from the copy event and fed
// back through a synthetic paste event, so parallel workers never share an OS
// clipboard.
import { test, expect, Page } from '@playwright/test';
import {
  createFixturePart, openEditor, enterSketchOnXY, drawClosedRectangle, extrudeSketch, featureRows, ensureCheckedOut,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_A = 0, PART_B = 0;
let copied = '';

test.beforeAll(async () => {
  const a = await createFixturePart('copy-src');
  PART_A = a.partId;
  await a.api.dispose();
  const b = await createFixturePart('copy-dst');
  PART_B = b.partId;
  await b.api.dispose();
});

/** Record what the next copy puts on the clipboard. */
async function captureCopies(page: Page) {
  await page.evaluate(() => {
    const orig = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type: string, value: string) {
      if (type === 'text/plain') (window as any).__copied = value;
      return orig.call(this, type, value);
    };
  });
}

async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

const extrudes = (page: Page) => page.evaluate(() =>
  ((window as any).__cadApp.featureTree.features as any[]).filter(f => f.type === 'extrude'));

test('copy an extrude and paste it onto another plane in the same part', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, PART_A);
  await enterSketchOnXY(page);
  await drawClosedRectangle(page, 60);
  await extrudeSketch(page, 10);
  await captureCopies(page);

  await featureRows(page).nth(1).click({ button: 'right' });
  await page.locator('[data-testid="ctx-copy-items"]').click();
  copied = await page.evaluate(() => (window as any).__copied as string);
  const bundle = JSON.parse(copied);
  expect(bundle).toMatchObject({ kind: 'letwinventory-cad', scope: 'items' });
  expect(bundle.features).toHaveLength(1);
  expect(bundle.sketches).toHaveLength(1);

  await page.evaluate(() => (window as any).__cadSetSelected('datum:xz_plane'));
  await paste(page, copied);
  await expect.poll(async () => (await extrudes(page)).length, { timeout: 10_000 }).toBe(2);
  const [first, second] = await extrudes(page);
  expect(second.id).not.toBe(first.id);
  expect(second.sketchId).not.toBe(first.sketchId);
  expect(second.name).toBe('Extrude 2');
  const planes = await page.evaluate(([a, b]) => {
    const s = (window as any).__cadApp.doc.sketches;
    return [s[a].hostId, s[b].hostId];
  }, [first.sketchId, second.sketchId]);
  expect(planes).toEqual(['datum:xy_plane', 'datum:xz_plane']);

  // One undoable edit.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await extrudes(page)).length, { timeout: 10_000 }).toBe(1);
});

test('paste into another part lists unresolved references', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, PART_B);
  await ensureCheckedOut(page);
  // The same copy, made to target a body that only exists in the source part.
  const bundle = JSON.parse(copied);
  bundle.features[0].bodyIds = ['fmissing01'];
  await paste(page, JSON.stringify(bundle));

  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-testid="paste-ref"]')).toHaveCount(1);
  await expect(dialog.locator('[data-testid="paste-ref"]')).toContainText('merge target body');
  await dialog.locator('[data-testid="paste-ok"]').click();

  await expect.poll(async () => (await extrudes(page)).length, { timeout: 10_000 }).toBe(1);
  const [pasted] = await extrudes(page);
  expect(pasted.bodyIds).toBeUndefined();
  expect(pasted.id).not.toBe(bundle.features[0].id);
});

// REQ 1104 — right-click on an empty area of the tree: New folder / Paste.
test('blank tree area offers New folder and Paste', async ({ page }) => {
  await openEditor(page, PART_B);
  await ensureCheckedOut(page);
  await page.locator('[data-testid="tab-features"]').click();
  const tree = page.locator('ul.tree').first();
  const box = (await tree.boundingBox())!;
  page.once('dialog', d => d.accept('Fixtures'));
  await tree.click({ button: 'right', position: { x: box.width / 2, y: box.height - 8 } });
  await expect(page.locator('[data-testid="ctx-blank-paste"]')).toBeVisible();
  await page.locator('[data-testid="ctx-blank-new-folder"]').click();
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadApp.featureTree.treeFolders ?? []).map((f: any) => [f.name, f.memberKeys.length])))
    .toEqual([['Fixtures', 0]]);
  await expect(page.locator('ul.tree').first()).toContainText('Fixtures');
});
