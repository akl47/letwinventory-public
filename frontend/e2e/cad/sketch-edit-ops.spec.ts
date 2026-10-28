// REQ 927 — sketch edit operations e2e: trim, extend, mirror, offset,
// convert entities (with the REQ 921 sidebar), sketch fillet.
import { test, expect } from '@playwright/test';
import {
  createFixturePart, openEditor, enterSketchOnXY, exitSketch, pickTool,
  clickSequence, canvasCenter, sketchEntityCount, sketchEntities,
  sketchConstraints, drawClosedRectangle, extrudeSketch, sketchToScreen,
} from './helpers';

// A fresh fixture part per test: reopening a part frames its existing
// sketches, which moves the origin under the canvas-centred click points
// (axis/origin snaps hijack them). Serial to keep load predictable.
test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeEach(async () => {
  const fx = await createFixturePart('editops');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

test.describe('Trim / Extend', () => {
  test('trim removes the clicked segment of a crossed line', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);
    // A plus-sign OFFSET from the datum axes — segments riding the X/Y
    // axis lines get eaten by axis picking/inference instead of drawing.
    const dy = 23;   // horizontal line's screen y offset
    const vx = -31;  // vertical line's screen x offset
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx - 90, cy + dy], [cx + 90, cy + dy]]);
    await page.keyboard.press('Escape');
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx + vx, cy - 90], [cx + vx, cy + 90]]);
    await page.keyboard.press('Escape');
    await expect.poll(() => sketchEntityCount(page, 'line')).toBe(2);

    // Crossing point in SKETCH coords = (vertical line's x, horizontal's y).
    const cross = await page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const P = (id: string) => ents.find((e: any) => e.id === id);
      const ls = ents.filter((e: any) => e.kind === 'line')
        .map((l: any) => ({ s: P(l.startId), e: P(l.endId) }));
      const horiz = ls.find((l: any) => Math.abs(l.s.y - l.e.y) < Math.abs(l.s.x - l.e.x))!;
      const vert = ls.find((l: any) => l !== horiz)!;
      return { x: (vert.s.x + vert.e.x) / 2, y: (horiz.s.y + horiz.e.y) / 2 };
    });

    // Trim the horizontal line's RIGHT segment (right of the crossing).
    await pickTool(page, 'edit', 'trim');
    await clickSequence(page, [[cx + 45, cy + dy]], 400);
    // The right piece is gone: no near-horizontal endpoint extends past
    // the crossing x.
    await expect.poll(() => page.evaluate((crossX) => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const P = (id: string) => ents.find((e: any) => e.id === id);
      let maxX = -Infinity;
      for (const l of ents.filter((e: any) => e.kind === 'line')) {
        const s = P(l.startId), e = P(l.endId);
        if (!s || !e) continue;
        if (Math.abs(s.y - e.y) >= Math.abs(s.x - e.x)) continue;  // vertical
        maxX = Math.max(maxX, s.x, e.x);
      }
      return maxX - crossX;
    }, cross.x), { timeout: 5_000 }).toBeLessThan(0.5);
  });

  test('extend stretches a line to the next boundary', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);
    // Vertical boundary + a short horizontal line stopping left of it —
    // both OFFSET from the datum axes (and the origin) so axis picking
    // can't hijack the clicks.
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx + 80, cy - 80], [cx + 80, cy + 80]]);
    await page.keyboard.press('Escape');
    await pickTool(page, 'primitives', 'line');
    await clickSequence(page, [[cx - 80, cy + 27], [cx - 20, cy + 27]]);
    await page.keyboard.press('Escape');

    const shortLineEndX = async () => page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const lines = ents.filter((e: any) => e.kind === 'line');
      const l = lines[lines.length - 1];
      const e = ents.find((x: any) => x.id === l.endId);
      return e?.x ?? NaN;
    });
    const beforeX = await shortLineEndX();

    await pickTool(page, 'edit', 'extend');
    // On the line, free-end side of its midpoint — but clear of the endpoint
    // marker, which grid snapping can pull toward a click right beside it.
    await clickSequence(page, [[cx - 40, cy + 27]], 400);
    await expect.poll(shortLineEndX, { timeout: 5_000 }).toBeGreaterThan(beforeX + 1);
  });
});

test.describe('Mirror (axis-first, REQ from 2026-07 batch)', () => {
  test('mirroring a circle across a centerline doubles it', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    const { cx, cy } = await canvasCenter(page);
    await pickTool(page, 'primitives', 'centerline');
    await clickSequence(page, [[cx, cy - 90], [cx, cy + 90]]);
    await page.keyboard.press('Escape');
    await pickTool(page, 'circles', 'circle');
    await clickSequence(page, [[cx - 60, cy + 25], [cx - 35, cy + 25]]);

    await pickTool(page, 'edit', 'mirror');
    await expect(page.locator('[data-testid="mirror-sidebar"]')).toBeVisible({ timeout: 5_000 });
    // Aim at the committed (grid-snapped) geometry, not the drawing clicks.
    const { axisPt, circlePt } = await page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const pt = (id: string) => ents.find((e: any) => e.id === id);
      const axis = ents.find((e: any) => e.kind === 'line' && e.construction);
      const circle = ents.find((e: any) => e.kind === 'circle');
      const a = pt(axis.startId), b = pt(axis.endId), c = pt(circle.centerId);
      return {
        axisPt: [a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3],
        circlePt: [c.x - circle.radius, c.y],
      };
    });
    // Stage 1: pick the axis (the centerline).
    await clickSequence(page, [await sketchToScreen(page, axisPt[0], axisPt[1])], 300);
    // Stage 2: pick the circle, then OK.
    await clickSequence(page, [await sketchToScreen(page, circlePt[0], circlePt[1])], 300);
    await page.locator('[data-testid="mirror-ok"]').click();
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(2);
    // One circle on each side of the axis (the view isn't centred on x=0).
    const { xs, axisX } = await page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const axis = ents.find((e: any) => e.kind === 'line' && e.construction);
      return {
        axisX: ents.find((p: any) => p.id === axis.startId)?.x ?? NaN,
        xs: ents.filter((e: any) => e.kind === 'circle')
          .map((c: any) => ents.find((p: any) => p.id === c.centerId)?.x ?? NaN),
      };
    });
    expect(Math.max(...xs)).toBeGreaterThan(axisX);
    expect(Math.min(...xs)).toBeLessThan(axisX);
  });
});

test.describe('Offset', () => {
  test('offsetting a circle outward creates a larger concentric circle', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    // Grid snap relocates the drawn circle away from the click coords —
    // turn it off for this test.
    await page.locator('[data-testid="sketch-settings"]').click();
    await page.locator('[data-testid="setting-grid-snap"]').click();
    await page.keyboard.press('Escape');
    // The offset tool opens a SIDE PANEL that resizes the canvas, shifting
    // every drawn pixel. Neutralize that: center the circle on the ORIGIN
    // (the canvas center keeps mapping to the camera target through
    // resizes) and probe the rim VERTICALLY (immune to width-only aspect
    // changes).
    const { cx, cy } = await canvasCenter(page);
    const R = 45;
    await pickTool(page, 'circles', 'circle');
    await clickSequence(page, [[cx, cy], [cx + R, cy]]);
    const baseRadius = (await sketchEntities(page)).find(e => e.kind === 'circle')?.radius;
    // Smaller than the radius: the click side picks the direction, and an
    // inward offset past the centre creates nothing.
    const D = Math.round((baseRadius / 3) * 100) / 100;

    await pickTool(page, 'edit', 'offset');
    const dist = page.locator('[data-testid="offset-distance-input"]');
    await expect(dist).toBeVisible({ timeout: 5_000 });
    await dist.fill(String(D));
    // Queue click ON the top rim (recomputed canvas center), then OK.
    const { cx: cx2, cy: cy2 } = await canvasCenter(page);
    const ok = page.locator('[data-testid="offset-ok"]');
    for (const dy of [R, R + 2, R - 2, R + 4, R - 4]) {
      await clickSequence(page, [[cx2, cy2 - dy]], 400);
      if (await ok.isEnabled().catch(() => false)) break;
    }
    await expect(ok).toBeEnabled({ timeout: 5_000 });
    await ok.click();
    await expect.poll(() => sketchEntityCount(page, 'circle'), { timeout: 5_000 }).toBe(2);
    const radii = (await sketchEntities(page)).filter(e => e.kind === 'circle').map(e => e.radius).sort((a, b) => a - b);
    expect(radii[1]).toBeCloseTo(radii[0] + D, 1);
    // One of the two is the original (direction depends on the click side).
    expect(Math.min(Math.abs(radii[0] - baseRadius), Math.abs(radii[1] - baseRadius))).toBeLessThan(0.1);
  });
});

test.describe('Convert Entities (REQ 921 sidebar)', () => {
  test('converting a body edge projects it with an on-edge link; chain converts the loop; list removes', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page, PART_ID);
    // Build a body first: rectangle → extrude.
    await enterSketchOnXY(page);
    await drawClosedRectangle(page, 60);
    await extrudeSketch(page, 10);

    // New sketch on XY again; the body's bottom face edges lie in-plane.
    await enterSketchOnXY(page);
    await pickTool(page, 'edit', 'convert-entities');
    await expect(page.locator('[data-testid="convert-entities-sidebar"]')).toBeVisible({ timeout: 5_000 });

    // Single conversion: pick a bottom-loop straight edge via the debug
    // hook (raycast clicks have sub-pixel margins under grid snap). Wait for
    // the extruded body's topology to land first — slow runners lag the regen.
    const findBottomEdge = () => page.evaluate(() => {
      const g = (window as any).__cadApp?.geometry;
      const e = (g?.topology?.edges ?? []).find((x: any) =>
        x.isStraight && Math.abs(x.endpoints[0][2]) < 1e-6 && Math.abs(x.endpoints[1][2]) < 1e-6);
      return e?.id ?? null;
    });
    await expect.poll(findBottomEdge, { timeout: 20_000 }).not.toBeNull();
    const firstEdge = await findBottomEdge();
    await page.evaluate((eid) => (window as any).__cadPickEdge(eid), firstEdge);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 10_000 }).toBe(1);
    const cons = await sketchConstraints(page);
    expect(cons.some(c => c.type === 'on-edge')).toBe(true);
    // REQ 939 — re-converting the SAME edge must not add a second line.
    await page.evaluate((eid) => (window as any).__cadPickEdge(eid), firstEdge);
    await page.waitForTimeout(300);
    expect(await sketchEntityCount(page, 'line')).toBe(1);

    // REQ 938 — the Projected Geometry rail section lists it; removing the row
    // deletes the entity.
    await expect(page.locator('[data-testid="projected-geometry-row-0"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="projected-geometry-remove-0"]').click();
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(0);

    // Chain option: one pick converts the whole 4-edge bottom loop.
    await page.locator('[data-testid="convert-chain"] input').check();
    await page.evaluate((eid) => (window as any).__cadPickEdge(eid), firstEdge);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 10_000 }).toBe(4);

    // Construction option applies to subsequent conversions — pick a
    // TOP-loop edge (projects onto the plane as a construction line).
    await page.locator('[data-testid="convert-chain"] input').uncheck();
    await page.locator('[data-testid="convert-construction"] input').check();
    const topPicked = await page.evaluate(() => {
      const g = (window as any).__cadApp?.geometry;
      const e = (g?.topology?.edges ?? []).find((x: any) =>
        x.isStraight && x.endpoints[0][2] > 1 && x.endpoints[1][2] > 1);
      if (!e) return false;
      return (window as any).__cadPickEdge(e.id);
    });
    expect(topPicked).toBe(true);
    await expect.poll(async () =>
      (await sketchEntities(page)).filter(e => e.kind === 'line' && e.construction === true).length,
    { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Sketch fillet', () => {
  test('filleting a rectangle corner replaces it with an arc', async ({ page }) => {
    await openEditor(page, PART_ID);
    await enterSketchOnXY(page);
    await drawClosedRectangle(page);
    // Pre-select a corner POINT — the fillet panel seeds its corner list
    // from the selection (pixel-clicking two lines is flaky under snap).
    const cornerId = await page.evaluate(() => {
      const ents = (window as any).__cadSketch?.entities ?? [];
      const l = ents.find((e: any) => e.kind === 'line');
      return l.startId;
    });
    await page.locator('[data-testid="tool-select"]').click();
    await page.evaluate((id) => (window as any).__cadSketchSelect([id]), cornerId);
    await pickTool(page, 'edit', 'fillet');
    const radius = page.locator('[data-testid="fillet-radius-input"]');
    await expect(radius).toBeVisible({ timeout: 5_000 });
    await radius.fill('5');
    const ok = page.locator('[data-testid="fillet-ok"]');
    await expect(ok).toBeEnabled({ timeout: 5_000 });
    await ok.click();
    await expect.poll(() => sketchEntityCount(page, 'arc'), { timeout: 5_000 }).toBe(1);
  });
});
