// REQ 925 — sketch primitive tools e2e. Each test draws with real canvas
// clicks and asserts the resulting entity model (kinds + counts) through
// the __cadSketch debug hook. A fresh sketch per test keeps counts exact.
import { expect } from '@playwright/test';
import {
  sharedEditorTest as test, enterSketchOnXY, pickTool, clickSequence,
  canvasCenter, sketchEntityCount, sketchEntities, sketchConstraints, drawClosedRectangle, sketchToScreen,
} from './helpers';

// One shared editor, reset to an empty model after each test (see
// sharedEditorTest). Serial: the tests take turns on that editor.
test.describe.configure({ mode: 'serial' });

test.describe('Primitive tools', () => {
  test('point', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'primitives', 'point');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx + 40, cy - 30]]);
    await expect.poll(() => sketchEntityCount(page, 'point'), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2); // origin + placed
  });

  test('line chain closes into a rectangle (4 lines)', async ({ page }) => {
    await enterSketchOnXY(page);
    await drawClosedRectangle(page);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(4);
  });

  test('centerline draws a construction line', async ({ page }) => {
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
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx + 50, cy - 40], [cx + 90, cy - 40]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(1);
    const circle = (await sketchEntities(page)).find(e => e.kind === 'circle');
    expect(circle.radius).toBeGreaterThan(0);
  });

  // REQ 1032 — Repeat / Repeat boss placement modes.
  test('repeat mode places same-diameter circles with one click each', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle');
    await page.locator('[data-testid="circle-mode-repeat"] input').check();
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 70, cy - 40], [cx - 50, cy - 40], [cx + 30, cy - 40], [cx + 30, cy + 50]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(3);
    const circles = (await sketchEntities(page)).filter(e => e.kind === 'circle');
    const ids = new Set(circles.map(c => c.id));
    const equals = (await sketchConstraints(page)).filter(c => c.type === 'equal'
      && c.targets.every((t: any) => ids.has(t.entityId)));
    expect(equals).toHaveLength(2);
    for (const c of circles) expect(c.radius).toBeCloseTo(circles[0].radius, 3);
    await page.locator('[data-testid="circle-mode-single"] input').check();
  });

  test('repeat boss mode places concentric pairs with one click each', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle');
    await page.locator('[data-testid="circle-mode-boss"] input').check();
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 60, cy - 40], [cx - 45, cy - 40], [cx - 30, cy - 40], [cx + 50, cy + 40]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(4);
    const circles = (await sketchEntities(page)).filter(e => e.kind === 'circle');
    // Two bosses, each an inner + outer circle sharing one center point.
    const byCenter = new Map<string, any[]>();
    for (const c of circles) byCenter.set(c.centerId, [...(byCenter.get(c.centerId) ?? []), c]);
    expect([...byCenter.values()].map(g => g.length)).toEqual([2, 2]);
    const equals = (await sketchConstraints(page)).filter(c => c.type === 'equal');
    expect(equals).toHaveLength(2);
    await page.locator('[data-testid="circle-mode-single"] input').check();
  });

  test('perimeter circle (two diameter clicks)', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'circle-perimeter');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 80, cy], [cx - 20, cy]]);
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(1);
  });

  test('center arc (center, start, end)', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'arc');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy + 60], [cx + 70, cy + 60], [cx, cy - 10]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
  });

  test('3-point arc', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'arc-3pt');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 70, cy], [cx + 70, cy], [cx, cy - 50]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
  });

  test('ellipse (center + major + minor)', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'circles', 'ellipse');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy], [cx + 90, cy], [cx, cy - 45]]);
    await expect.poll(() => sketchEntityCount(page, 'ellipse'), { timeout: 5_000 }).toBe(1);
  });
});

test.describe('Shape tools', () => {
  test('corner rectangle mints 4 lines + its constraint scheme', async ({ page }) => {
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

  // REQ 992 — a corner clicked ON an existing sketch line is coincident with it.
  test('corner rectangle clicked on an existing line is coincident with it', async ({ page }) => {
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx + 40, cy - 60], [cx + 240, cy - 100]]);
    await page.keyboard.press('Escape');
    const line = await page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const l = ents.find((e: any) => e.kind === 'line');
      const at = (id: string) => ents.find((e: any) => e.id === id);
      return l && { id: l.id, a: at(l.startId), b: at(l.endId) };
    });
    expect(line).toBeTruthy();
    const lineId = line.id;
    // 30% along the line's REAL (grid-snapped) geometry — off its midpoint
    // and endpoints — then a corner in open space.
    const onLine = await sketchToScreen(page,
      line.a.x + 0.3 * (line.b.x - line.a.x), line.a.y + 0.3 * (line.b.y - line.a.y));

    await pickTool(page, 'shapes', 'rect-corner');
    await clickSequence(page, [onLine, [cx + 200, cy + 60]]);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(5);

    const coincident = await page.evaluate((lid) => {
      const sk = (window as any).__cadSketch;
      return (sk?.constraints ?? []).filter((c: any) => c.type === 'coincident'
        && c.targets.some((t: any) => t.entityId === lid)).length;
    }, lineId);
    expect(coincident).toBe(1);
  });

  test('center rectangle draws 4 solid sides (+ construction diagonal)', async ({ page }) => {
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
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'polygon');
    const sides = page.locator('[data-testid="param-polygon-sides"]');
    await expect(sides).toBeVisible({ timeout: 5_000 });
    await sides.fill('6');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx, cy], [cx + 70, cy]]);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(6);
  });

  test('straight slot (endpoint, endpoint, width) = 2 lines + 2 tangent arcs + centerline', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'slot');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 60, cy + 40], [cx + 60, cy + 40], [cx, cy + 15]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(2);
    const lines = (await sketchEntities(page)).filter(e => e.kind === 'line');
    expect(lines.filter(l => !l.construction)).toHaveLength(2);
    // REQ 1034 — construction centerline (horizontal, inferred from the
    // level second click); rails tangent to both caps, parallel to it.
    const centerline = lines.find(l => l.construction);
    expect(centerline).toBeTruthy();
    const cons = await sketchConstraints(page);
    expect(cons.filter(c => c.type === 'tangent')).toHaveLength(4);
    expect(cons.filter(c => c.type === 'parallel' && c.targets[0].entityId === centerline.id)).toHaveLength(2);
    expect(cons.some(c => c.type === 'horizontal' && c.targets[0].entityId === centerline.id)).toBe(true);
  });

  // Dragging any slot point must keep both caps as semicircles of the same
  // radius. Targets: each rail end (a cap end) and each cap center.
  for (const shape of ['level', 'diagonal'] as const)
  for (const target of ['rail-0-start', 'rail-0-end', 'rail-1-start', 'rail-1-end', 'center-0', 'center-1'] as const) {
    for (const dir of ['x', 'y'] as const) {
      test(`dragging a ${shape} slot ${target} 5 mm along ${dir} keeps both caps as half circles`, async ({ page }) => {
        await enterSketchOnXY(page);
        await pickTool(page, 'shapes', 'slot');
        const { cx, cy } = await canvasCenter(page);
        await clickSequence(page, shape === 'level'
          ? [[cx - 60, cy + 40], [cx + 60, cy + 40], [cx, cy + 15]]
          : [[cx - 70, cy - 60], [cx + 40, cy + 70], [cx + 5, cy - 10]]);
        await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(2);
        await page.keyboard.press('Escape');  // back to Select
        await page.waitForTimeout(300);

        const caps = async () => page.evaluate(() => {
          const ents = (window as any).__cadSketch?.entities ?? [];
          const pt = (id: string) => ents.find((e: any) => e.id === id);
          return ents.filter((e: any) => e.kind === 'arc').map((a: any) => {
            const c = pt(a.centerId), s = pt(a.startId), e = pt(a.endId);
            let d = Math.atan2(e.y - c.y, e.x - c.x) - Math.atan2(s.y - c.y, s.x - c.x);
            if (!a.ccw) d = -d;
            while (d <= 1e-9) d += 2 * Math.PI;
            while (d > 2 * Math.PI) d -= 2 * Math.PI;
            return { sweep: d * 180 / Math.PI, radius: a.radius };
          });
        });
        const before = await caps();
        expect(before.map(a => Math.round(a.sweep))).toEqual([180, 180]);

        const start = await page.evaluate((t) => {
          const ents = (window as any).__cadSketch?.entities ?? [];
          const pt = (id: string) => ents.find((e: any) => e.id === id);
          const [kind, idx, which] = t.split('-');
          if (kind === 'center') {
            const arc = ents.filter((e: any) => e.kind === 'arc')[Number(idx)];
            return pt(arc.centerId);
          }
          const rail = ents.filter((e: any) => e.kind === 'line' && !e.construction)[Number(idx)];
          return pt(which === 'start' ? rail.startId : rail.endId);
        }, target);
        const [sx, sy] = await sketchToScreen(page, start.x, start.y);
        const [tx, ty] = await sketchToScreen(page, start.x + (dir === 'x' ? 5 : 0), start.y + (dir === 'y' ? 5 : 0));
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(sx + (tx - sx) * i / 10, sy + (ty - sy) * i / 10);
          await page.waitForTimeout(30);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);  // release commit + solve

        const after = await caps();
        expect(after, 'both caps still exist').toHaveLength(2);
        for (const a of after) {
          expect(a.sweep, 'cap is a half circle').toBeCloseTo(180, 0);
          expect(a.radius, 'cap radius unchanged').toBeCloseTo(before[0].radius, 3);
        }
      });
    }
  }

  test('tab (round end + square end) = 3 lines + 1 arc + centerline', async ({ page }) => {
    await enterSketchOnXY(page);
    await pickTool(page, 'shapes', 'slot-tab');
    const { cx, cy } = await canvasCenter(page);
    await clickSequence(page, [[cx - 60, cy + 40], [cx + 60, cy + 40], [cx, cy + 15]]);
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
    const lines = (await sketchEntities(page)).filter(e => e.kind === 'line');
    expect(lines.filter(l => !l.construction)).toHaveLength(3);
    expect(lines.filter(l => l.construction)).toHaveLength(1);
    const cons = await sketchConstraints(page);
    expect(cons.filter(c => c.type === 'tangent')).toHaveLength(2);
    const centerline = lines.find(l => l.construction);
    expect(cons.filter(c => c.type === 'parallel' && c.targets[0].entityId === centerline.id)).toHaveLength(2);
  });
});

test.describe('Draw-as-construction toggle', () => {
  test('entities drawn with the toggle on are construction', async ({ page }) => {
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
