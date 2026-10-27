// REQ 926 — constraints + dimensions e2e. The heart of this file is the
// inch-input regression (REQ 922): type a unit-suffixed dimension value in
// the inline editor and assert the GEOMETRY moves to the converted mm value
// — the class of bug where the label updates while the points stay put.
import { test, expect, Page } from '@playwright/test';
import {
  createFixturePart, openEditor, enterSketchOnXY, pickTool, clickSequence,
  canvasCenter, drawClosedRectangle, sketchConstraints, pointDistance,
} from './helpers';

// Tests share one fixture part — run serially even when the suite is
// configured fullyParallel (CI already uses workers: 1).
test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('dims');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

/** Smart-dim the FIRST drawn line's two endpoints, placing the dim at
 * `place`. Selection is set programmatically (__cadSketchSelect) — grid
 * snap makes pixel-perfect corner picks flaky — then the placement click
 * commits the dim. Returns the created dimensional constraint. */
async function smartDimFirstLine(page: Page, place: [number, number]): Promise<any> {
  const before = (await sketchConstraints(page)).filter(c => c.value !== undefined).length;
  const [aId, bId] = await page.evaluate(() => {
    const ents = (window as any).__cadSketch?.entities ?? [];
    const l = ents.find((e: any) => e.kind === 'line');
    return [l.startId, l.endId];
  });
  await page.evaluate(([a, b]) => (window as any).__cadSketchSelect([a, b]), [aId, bId]);
  await page.locator('[data-testid="tool-smart-dim"]').click();
  await clickSequence(page, [place], 400);
  // Smart-dim may open the inline value editor after placement — Escape
  // keeps the seeded (measured) value.
  const editor = page.locator('input[data-constraint-id]');
  if (await editor.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await expect.poll(async () =>
    (await sketchConstraints(page)).filter(c => c.value !== undefined).length,
  { timeout: 10_000 }).toBe(before + 1);
  const dims = (await sketchConstraints(page)).filter(c => c.value !== undefined);
  return dims[dims.length - 1];
}

test.describe('Smart dimension + inline value edit', () => {
  test('unit-suffixed input ("2 in") moves the geometry to 50.8 mm — REQ 922 regression', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const corners = await drawClosedRectangle(page);

    // Dimension the first drawn edge (top edge of the rectangle).
    const dim = await smartDimFirstLine(
      page, [(corners[0][0] + corners[1][0]) / 2 + 45, corners[0][1] - 40],
    );
    expect(dim.targets).toHaveLength(2);
    const [aId, bId] = dim.targets.map((t: any) => t.entityId);
    const measuredBefore = await pointDistance(page, aId, bId);
    expect(measuredBefore).toBeGreaterThan(0);
    // Sanity: the seeded dim matches geometry.
    expect(Math.abs(dim.value - measuredBefore)).toBeLessThan(1e-3);

    // Double-click the dim label → inline editor → type an INCH value.
    await page.locator(`div[data-constraint-id="${dim.id}"]`).dblclick();
    const editor = page.locator(`input[data-constraint-id="${dim.id}"]`);
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill('2 in');
    await editor.press('Enter');

    // THE regression assertion: geometry must MOVE to 2in = 50.8mm —
    // not just store the value on the constraint.
    await expect.poll(() => pointDistance(page, aId, bId), { timeout: 10_000 })
      .toBeCloseTo(50.8, 1);
    const updated = (await sketchConstraints(page)).find(c => c.id === dim.id);
    expect(updated.value).toBeCloseTo(50.8, 3);
    expect(updated.unit).toBe('in');
  });

  test('bare numeric input is interpreted in the model default unit (mm)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);  // each entry creates a FRESH sketch
    const corners = await drawClosedRectangle(page);
    const dim = await smartDimFirstLine(
      page, [(corners[0][0] + corners[1][0]) / 2 + 45, corners[0][1] - 40],
    );
    const [aId, bId] = dim.targets.map((t: any) => t.entityId);
    await page.locator(`div[data-constraint-id="${dim.id}"]`).dblclick();
    const editor = page.locator(`input[data-constraint-id="${dim.id}"]`);
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill('75');
    await editor.press('Enter');
    await expect.poll(() => pointDistance(page, aId, bId), { timeout: 10_000 })
      .toBeCloseTo(75, 1);
    // Bare number drops the per-dim unit override.
    const updated = (await sketchConstraints(page)).find(c => c.id === dim.id);
    expect(updated.unit ?? null).toBeNull();
  });
});

test.describe('Dimension context menu', () => {
  test('right-click → driven toggles the driven flag; delete removes the dim', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);  // fresh sketch — mint our own dim
    const corners = await drawClosedRectangle(page);
    const dim = await smartDimFirstLine(
      page, [(corners[0][0] + corners[1][0]) / 2 + 45, corners[0][1] - 40],
    );
    const label = page.locator(`div[data-constraint-id="${dim.id}"]`);

    await label.click({ button: 'right' });
    await page.locator('[data-testid="dim-ctx-driven"]').click();
    await expect.poll(async () =>
      (await sketchConstraints(page)).find(c => c.id === dim.id)?.driven === true,
    { timeout: 5_000 }).toBe(true);

    await label.click({ button: 'right' });
    await page.locator('[data-testid="dim-ctx-delete"]').click();
    await expect.poll(async () =>
      (await sketchConstraints(page)).some(c => c.id === dim.id),
    { timeout: 5_000 }).toBe(false);
  });
});

test.describe('Geometric constraints', () => {
  test('parallel makes two skew lines parallel; perpendicular follows', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);

    // Two deliberately SKEW lines away from the origin (no axis alignment,
    // so the inference engine doesn't pre-constrain them).
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx - 150, cy - 120], [cx - 40, cy - 95]]);
    await page.keyboard.press('Escape');
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx - 150, cy + 95], [cx - 40, cy + 140]]);
    await page.keyboard.press('Escape');

    const lines = await page.evaluate(() =>
      ((window as any).__cadSketch?.entities ?? []).filter((e: any) => e.kind === 'line').map((e: any) => e.id));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const [l1, l2] = lines.slice(-2);

    // Select both lines programmatically (midpoint clicks are flaky when
    // inference nudges the drawn geometry).
    await page.locator('[data-testid="tool-select"]').click();
    await page.evaluate(([a, b]) => (window as any).__cadSketchSelect([a, b]), [l1, l2]);

    const parallelBtn = page.locator('[data-testid="constraint-parallel"]');
    await expect(parallelBtn).toBeEnabled({ timeout: 5_000 });
    await parallelBtn.click();

    await expect.poll(async () =>
      (await sketchConstraints(page)).some(c => c.type === 'parallel'
        && c.targets.some((t: any) => t.entityId === l1)
        && c.targets.some((t: any) => t.entityId === l2)),
    { timeout: 5_000 }).toBe(true);

    // The solver must have actually rotated the lines parallel.
    const cross = await page.evaluate(([a, b]) => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const line = (id: string) => ents.find((e: any) => e.id === id);
      const pt = (id: string) => ents.find((e: any) => e.id === id);
      const dir = (l: any) => {
        const s = pt(l.startId), e = pt(l.endId);
        const len = Math.hypot(e.x - s.x, e.y - s.y);
        return [(e.x - s.x) / len, (e.y - s.y) / len];
      };
      const d1 = dir(line(a)), d2 = dir(line(b));
      return Math.abs(d1[0] * d2[1] - d1[1] * d2[0]);
    }, [l1, l2]);
    expect(cross).toBeLessThan(1e-4);
  });

  test('horizontal on a single skew line levels it', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx + 60, cy + 90], [cx + 170, cy + 130]]);
    await page.keyboard.press('Escape');

    const lineId = await page.evaluate(() => {
      const ls = ((window as any).__cadSketch?.entities ?? []).filter((e: any) => e.kind === 'line');
      return ls[ls.length - 1]?.id;
    });
    await page.locator('[data-testid="tool-select"]').click();
    await page.evaluate((id) => (window as any).__cadSketchSelect([id]), lineId);
    const btn = page.locator('[data-testid="constraint-horizontal"]');
    await expect(btn).toBeEnabled({ timeout: 5_000 });
    await btn.click();

    await expect.poll(() => page.evaluate((id) => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const l = ents.find((e: any) => e.id === id);
      if (!l) return NaN;
      const s = ents.find((e: any) => e.id === l.startId), e2 = ents.find((e: any) => e.id === l.endId);
      return Math.abs(e2.y - s.y);
    }, lineId), { timeout: 5_000 }).toBeLessThan(1e-4);
  });
});
