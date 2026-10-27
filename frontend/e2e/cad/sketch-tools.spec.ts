// REQ 925 — sketch primitive tools e2e. Each test draws with real canvas
// clicks and asserts the resulting entity model (kinds + counts) through
// the __cadSketch debug hook. A fresh sketch per test keeps counts exact.
import { test, expect } from '@playwright/test';
import {
  createFixturePart, openEditor, enterSketchOnXY, pickTool, clickSequence,
  canvasCenter, sketchEntityCount, sketchEntities, drawClosedRectangle,
} from './helpers';

// A fresh fixture part per test: reopening a part frames its existing
// sketches, which moves the origin under the canvas-centred click points
// (axis/origin snaps hijack them). Serial to keep load predictable.
test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeEach(async () => {
  const fx = await createFixturePart('tools');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

test.describe('Primitive tools', () => {
  test('point', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'primitives', 'point');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx + 40, cy - 30]]);
    await expect.poll(() => sketchEntityCount(page, 'point'), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2); // origin + placed
  });

  test('line chain closes into a rectangle (4 lines)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await drawClosedRectangle(page);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(4);
  });

  test('centerline draws a construction line', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'primitives', 'centerline');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 80, cy + 70], [cx + 80, cy + 70]]);
    await page.keyboard.press('Escape');
    await expect.poll(async () =>
      (await sketchEntities(page)).some(e => e.kind === 'line' && e.construction === true),
    { timeout: 5_000 }).toBe(true);
  });

  test('spline commits on Enter with the clicked control points', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'primitives', 'spline');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 90, cy], [cx - 30, cy - 60], [cx + 30, cy + 60], [cx + 90, cy]]);
    await page.keyboard.press('Enter');
    await expect.poll(() => sketchEntityCount(page, 'spline'), { timeout: 5_000 }).toBe(1);
  });
});

test.describe('Circle tools', () => {
  test('circle (center + radius)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx + 50, cy - 40], [cx + 90, cy - 40]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(1);
    const circle = (await sketchEntities(page)).find(e => e.kind === 'circle');
    expect(circle.radius).toBeGreaterThan(0);
  });

  test('perimeter circle (two diameter clicks)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle-perimeter');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 80, cy], [cx - 20, cy]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(1);
  });

  test('center arc (center, start, end)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'arc');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy + 60], [cx + 70, cy + 60], [cx, cy - 10]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
  });

  test('3-point arc', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'arc-3pt');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 70, cy], [cx + 70, cy], [cx, cy - 50]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
  });

  test('ellipse (center + major + minor)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'ellipse');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy], [cx + 90, cy], [cx, cy - 45]]);
    await expect.poll(() => sketchEntityCount(page, 'ellipse'), { timeout: 5_000 }).toBe(1);
  });
});

test.describe('Shape tools', () => {
  test('corner rectangle mints 4 lines + its constraint scheme', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'rect-corner');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 70, cy - 50], [cx + 70, cy + 50]]);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(4);
    // The rect tool constrains via horizontal + perpendicular + 2× parallel
    // (vertical is implied, not minted — same scheme as the part-623 rect).
    const constraints = await page.evaluate(() => ((window as any).__cadSketch?.constraints ?? []).map((c: any) => c.type));
    expect(constraints).toContain('horizontal');
    expect(constraints).toContain('perpendicular');
    expect(constraints.filter((t: string) => t === 'parallel').length).toBeGreaterThanOrEqual(2);
  });

  test('center rectangle draws 4 solid sides (+ construction diagonal)', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'rect-center');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx + 30, cy + 20], [cx + 100, cy + 65]]);
    // 4 solid sides; the center-anchor diagonal comes in as construction.
    await expect.poll(() => page.evaluate(() =>
      ((window as any).__cadSketch?.entities ?? [])
        .filter((e: any) => e.kind === 'line' && !e.construction).length,
    ), { timeout: 5_000 }).toBe(4);
  });

  test('polygon honors the sides input', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'polygon');
    const sides = page.locator('[data-testid="param-polygon-sides"]');
    await expect(sides).toBeVisible({ timeout: 5_000 });
    await sides.fill('6');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy], [cx + 70, cy]]);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(6);
  });

  test('straight slot (endpoint, endpoint, width) = 2 lines + 2 arcs', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'slot');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 60, cy], [cx + 60, cy], [cx, cy - 25]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(2);
    expect(await sketchEntityCount(page, 'line')).toBe(2);
  });
});

test.describe('Draw-as-construction toggle', () => {
  test('entities drawn with the toggle on are construction', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await page.locator('[data-testid="toggle-draw-construction"]').click();
    await pickTool(page, 'circles', 'circle');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 50, cy + 40], [cx - 10, cy + 40]]);
    await expect.poll(async () =>
      (await sketchEntities(page)).find(e => e.kind === 'circle')?.construction === true,
    { timeout: 5_000 }).toBe(true);
  });
});
