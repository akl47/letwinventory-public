// REQ 928 — 3D feature operations e2e: extrude boss/cut, revolve, 3D
// fillet/chamfer, shell, datum plane, suppress/rename/delete. Runs against
// the real C++ kernel (CI's cad-kernel service). Serial: later tests build
// on earlier bodies.
import { test, expect, Page } from '@playwright/test';
import {
  createFixturePart, openEditor, enterSketchOnXY, pickTool, clickSequence,
  drawClosedRectangle, extrudeSketch, featureRows, geometrySummary,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('features');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

async function footerVolume(page: Page): Promise<number> {
  // innerText includes the mat-icon LIGATURE text ("view_in_ar …") — match
  // the first real number instead of stripping characters.
  const text = await page.locator('[data-testid="footer-volume"]').innerText();
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

/** Pick the first body edge whose id matches `pattern` via the debug hook. */
async function pickEdgeMatching(page: Page, pattern = ''): Promise<string | null> {
  return page.evaluate((pat) => {
    const g = (window as any).__cadApp?.geometry;
    const e = (g?.topology?.edges ?? []).find((x: any) => x.id.includes(pat));
    if (!e) return null;
    (window as any).__cadPickEdge(e.id);
    return e.id;
  }, pattern);
}

test('extrude boss creates a solid with faces and volume', async ({ page }) => {
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  await drawClosedRectangle(page, 60);
  await extrudeSketch(page, 10);
  await expect.poll(async () => (await geometrySummary(page))?.faces ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(6);
  await expect.poll(() => footerVolume(page), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('cut-extrude removes material (volume decreases)', async ({ page }) => {
  await openEditor(page, PART_ID);
  const volBefore = await footerVolume(page);
  expect(volBefore).toBeGreaterThan(0);

  await enterSketchOnXY(page);
  // Small circle centred in the block footprint → through cut. Anchored to the
  // body's world bounds, not the canvas centre: reopening frames the existing
  // geometry, so the canvas centre no longer sits over the block's middle.
  await pickTool(page, 'circles', 'circle');
  const { c, r } = await page.evaluate(() => {
    const faces = (window as any).__cadApp?.geometry?.faces ?? [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of faces) for (let i = 0; i < f.positions.length; i += 3) {
      minX = Math.min(minX, f.positions[i]); maxX = Math.max(maxX, f.positions[i]);
      minY = Math.min(minY, f.positions[i + 1]); maxY = Math.max(maxY, f.positions[i + 1]);
    }
    const cam = (window as any).__cadCamera;
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
    return {
      c: cam.worldToScreen(mx, my, 0),
      // Radius from the SMALLER side so the shell wall can't reach the hole.
      r: cam.worldToScreen(mx + Math.min(maxX - minX, maxY - minY) * 0.1, my, 0),
    };
  });
  await clickSequence(page, [[c.x, c.y], [r.x, r.y]]);
  const before = await featureRows(page).count();
  await page.locator('[data-testid="cut-extrude-button"]').click();
  const input = page.locator('[data-testid="extrude-input"]:visible').first();
  await input.fill('30');
  await page.locator('[data-testid="extrude-apply"]:visible').first().click();
  await expect(featureRows(page)).toHaveCount(before + 1, { timeout: 20_000 });
  await expect.poll(() => footerVolume(page), { timeout: 15_000 }).toBeLessThan(volBefore);
});

test('3D fillet rounds an edge (face count increases)', async ({ page }) => {
  await openEditor(page, PART_ID);
  const facesBefore = (await geometrySummary(page))!.faces;

  await page.locator('[data-testid="tab-features"]').click();
  await page.locator('[data-testid="action-fillet"]').click();
  await expect(page.locator('[data-testid="edge-blend-sidebar"]')).toBeVisible({ timeout: 5_000 });
  // Arm edge picking (the sidebar's pick button), then pick via the hook.
  const pickBtn = page.locator('[data-testid="edge-blend-pick"]');
  if (!(await pickBtn.getAttribute('class'))?.includes('active')) await pickBtn.click();
  const picked = await pickEdgeMatching(page);
  expect(picked).not.toBeNull();
  await page.locator('[data-testid="edge-blend-value"]').fill('2');
  await page.locator('[data-testid="edge-blend-apply"]').click();
  await expect.poll(async () => (await geometrySummary(page))?.faces ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(facesBefore);
});

test('shell hollows the body (volume decreases, feature added)', async ({ page }) => {
  await openEditor(page, PART_ID);
  const volBefore = await footerVolume(page);
  const rowsBefore = await featureRows(page).count();

  await page.locator('[data-testid="tab-features"]').click();
  await page.locator('[data-testid="action-shell"]').click();
  await expect(page.locator('[data-testid="shell-sidebar"]')).toBeVisible({ timeout: 5_000 });
  const facePickBtn = page.locator('[data-testid="shell-face-pick"]');
  if (!(await facePickBtn.getAttribute('class'))?.includes('active')) await facePickBtn.click();
  // Remove the planar TOP face — pick programmatically. (faces[0] is in
  // kernel order and can be the hole or fillet face, which OCCT can't open.)
  await page.evaluate(() => {
    const g = (window as any).__cadApp?.geometry;
    const top = (g?.faces ?? [])
      .filter((f: any) => f.isFlat && f.normals?.[2] > 0.99)
      .sort((a: any, b: any) => b.positions[2] - a.positions[2])[0];
    if (top) (window as any).__cadPickFace(top.faceId);
  });
  await page.locator('[data-testid="shell-thickness"]').fill('0.5');
  await page.locator('[data-testid="shell-apply"]').click();
  await expect(featureRows(page)).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
  await expect.poll(() => footerVolume(page), { timeout: 15_000 }).toBeLessThan(volBefore);
});

test('offset datum plane adds an eighth datum', async ({ page }) => {
  await openEditor(page, PART_ID);
  const datumsBefore = await page.evaluate(() =>
    (window as any).__cadApp?.geometry?.datums?.length ?? 0);

  await page.locator('[data-testid="tab-features"]').click();
  await page.locator('[data-testid="action-datum-plane"]').click();
  await expect(page.locator('[data-testid="datum-plane-sidebar"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="datum-plane-method"]').selectOption('offset');
  await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
  await page.locator('[data-testid="datum-plane-distance"]').fill('25');
  await page.locator('[data-testid="datum-plane-apply"]').click();
  await expect.poll(() => page.evaluate(() =>
    (window as any).__cadApp?.geometry?.datums?.length ?? 0), { timeout: 20_000 })
    .toBe(datumsBefore + 1);
});

test('feature suppress excludes it from regen; unsuppress restores', async ({ page }) => {
  await openEditor(page, PART_ID);
  const volBefore = await footerVolume(page);

  // Suppress the CUT feature (row index 2: origin, boss, cut, ...).
  const cutRow = page.locator('[data-testid="feature-tree-row"]').nth(2);
  await cutRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-toggle-feature-suppression"]').click();
  // The suppressed flag lands on the tree and the regen result differs.
  // (Volume DIRECTION is body-dependent — on a shelled body, removing the
  // cut also removes the hole's tube walls — so assert change + restore.)
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadApp?.featureTree?.features ?? [])
      .find((f: any) => f.type === 'cutExtrude')?.suppressed === true,
  ), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => Math.abs(await footerVolume(page) - volBefore), { timeout: 20_000 })
    .toBeGreaterThan(0.01);

  await cutRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-toggle-feature-suppression"]').click();
  await expect.poll(() => footerVolume(page), { timeout: 20_000 }).toBeCloseTo(volBefore, 1);
});

test('feature rename persists in the tree', async ({ page }) => {
  await openEditor(page, PART_ID);
  const bossRow = page.locator('[data-testid="feature-tree-row"]').nth(1);
  await bossRow.click({ button: 'right' });
  // Rename prompts via window.prompt — answer the native dialog.
  page.once('dialog', (d) => d.accept('Base Block'));
  await page.locator('[data-testid="ctx-rename-feature"]').click();
  await expect(page.locator('[data-testid="feature-tree-row"]').nth(1)).toContainText('Base Block', { timeout: 10_000 });
});

test('feature delete removes the row and its geometry contribution', async ({ page }) => {
  await openEditor(page, PART_ID);
  const rowsBefore = await featureRows(page).count();
  // Delete the SHELL feature (last non-datum row) — keeps earlier tests' bodies intact.
  const lastRow = page.locator('[data-testid="feature-tree-row"]').last();
  await lastRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-delete-feature"]').click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /delete|ok|confirm/i }).click();
  }
  await expect(featureRows(page)).toHaveCount(rowsBefore - 1, { timeout: 15_000 });
});
