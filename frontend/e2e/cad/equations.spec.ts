// REQ 930 — equations e2e: define a variable, drive a dimension with
// =expression, change the variable and watch the geometry follow.
import { test, expect, Page } from '@playwright/test';
import {
  createFixturePart, openEditor, ensureCheckedOut, enterSketchOnXY, exitSketch,
  drawClosedRectangle, clickSequence, sketchConstraints, pointDistance,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('equations');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

async function openEquationsPanel(page: Page) {
  await page.locator('[data-testid="tab-tools"]').click();
  await page.locator('[data-testid="action-equations"]').click();
}

async function addVariable(page: Page, name: string, expression: string) {
  await page.locator('[data-testid="eqn-draft-name"]').fill(name);
  await page.locator('[data-testid="eqn-draft-expression"]').fill(expression);
  await page.locator('[data-testid="eqn-draft-expression"]').press('Enter');
  // Rows render as inputs — assert by value, not text content.
  await expect(page.locator('[data-testid="eqn-name"]').last()).toHaveValue(name, { timeout: 5_000 });
}

test('a variable drives a dimension via =expr, and updates propagate', async ({ page }) => {
  await openEditor(page, PART_ID);

  // 1. Define width = 55 in the equations panel (checkout first — the
  // panel is view-only on an unlocked working copy).
  await ensureCheckedOut(page);
  await openEquationsPanel(page);
  await addVariable(page, 'width', '55');
  await page.locator('[data-testid="eqn-close"]').click();

  // 2. Rectangle + smart dim on the first edge (programmatic selection —
  // pixel-perfect corner picks are flaky under grid snap).
  await enterSketchOnXY(page);
  const corners = await drawClosedRectangle(page);
  const [pa, pb] = await page.evaluate(() => {
    const ents = (window as any).__cadSketch?.entities ?? [];
    const l = ents.find((e: any) => e.kind === 'line');
    return [l.startId, l.endId];
  });
  await page.evaluate(([a, b]) => (window as any).__cadSketchSelect([a, b]), [pa, pb]);
  await page.locator('[data-testid="tool-smart-dim"]').click();
  await clickSequence(page, [
    [(corners[0][0] + corners[1][0]) / 2 + 45, corners[0][1] - 40],
  ], 400);
  const editorInput = page.locator('input[data-constraint-id]');
  if (await editorInput.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  const dims = (await sketchConstraints(page)).filter(c => c.value !== undefined);
  expect(dims.length).toBe(1);
  const dim = dims[0];
  const [aId, bId] = dim.targets.map((t: any) => t.entityId);

  // 3. Bind the dim to the variable: "=width".
  await page.locator(`div[data-constraint-id="${dim.id}"]`).dblclick();
  const editor = page.locator(`input[data-constraint-id="${dim.id}"]`);
  await expect(editor).toBeVisible({ timeout: 5_000 });
  await editor.fill('=width');
  await editor.press('Enter');
  await expect.poll(() => pointDistance(page, aId, bId), { timeout: 10_000 }).toBeCloseTo(55, 1);
  // Driven label renders with the Σ prefix.
  await expect(page.locator(`div[data-constraint-id="${dim.id}"]`)).toContainText('Σ');

  // 4. Change the variable → geometry follows without touching the dim.
  // (Exit the sketch first — the Features tab is hidden in sketch mode.)
  await exitSketch(page);
  await openEquationsPanel(page);
  const expr = page.locator('[data-testid="eqn-expression"]').first();
  await expr.fill('80');
  await expr.blur();  // rows commit on BLUR, not Enter
  await expect.poll(() => page.evaluate(() =>
    (window as any).__cadEquations?.entries?.width?.expression ?? null,
  ), { timeout: 5_000 }).toBe('80');
  await page.locator('[data-testid="eqn-close"]').click();
  // Frontend sketch docs re-drive bound dims on RECOMMIT (the backend
  // substitutes at regen time for 3D). Re-enter the sketch and re-confirm
  // the =width binding — it must now resolve to 80 and move the geometry.
  const sketchRow = page.locator('[data-testid="sketch-tree-row"]').first();
  await sketchRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-edit-sketch"]').click();
  await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible({ timeout: 10_000 });
  await page.locator(`div[data-constraint-id="${dim.id}"]`).dblclick();
  const reEditor = page.locator(`input[data-constraint-id="${dim.id}"]`);
  await expect(reEditor).toBeVisible({ timeout: 5_000 });
  await expect(reEditor).toHaveValue('=width');  // binding survives
  await reEditor.press('Enter');
  await expect.poll(() => pointDistance(page, aId, bId), { timeout: 15_000 }).toBeCloseTo(80, 1);
});

test('equation values survive reload', async ({ page }) => {
  await openEditor(page, PART_ID);
  const eq = await page.evaluate(() => (window as any).__cadEquations);
  expect(eq?.entries?.width?.expression).toBe('80');
});
