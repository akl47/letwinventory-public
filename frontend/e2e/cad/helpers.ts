// Shared harness for the CAD e2e suite (REQ 924). Every spec file creates
// its OWN disposable fixture part so releases/locks never leak across specs.
//
// Debug hooks (non-prod builds, see CadEditorComponent):
//   window.__cadApp        — { mode, featureTree, doc, selected, geometry }
//   window.__cadSketch     — active sketch state ({ entities, constraints })
//   window.__cadSetSelected(id) — programmatic selection (datum picks etc.)
//   window.__cadAsm        — assembly mode: { instances, mates, equations }
//   window.__cadEquations  — equations doc
import { expect, request as pwRequest, Page, APIRequestContext } from '@playwright/test';

export interface CadFixture {
  api: APIRequestContext;
  token: string;
  partId: number;
}

export async function loginApi(): Promise<{ api: APIRequestContext; token: string }> {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4201';
  const api = await pwRequest.newContext({ baseURL });
  const login = await api.post('/api/auth/google/test-login', { data: { email: 'e2e@test.local' } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = await login.json();
  return { api, token: accessToken };
}

/** Create a disposable fixture part. `label` keeps concurrent spec files
 * from colliding on the unique (name, revision) index. */
export async function createFixturePart(label: string): Promise<CadFixture> {
  const { api, token } = await loginApi();
  const created = await api.post('/api/inventory/part', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `E2E CAD ${label} ${Date.now() % 1_000_000_000}`,
      revision: '01',
      internalPart: true,
      partCategoryID: 1,
      vendor: 'E2E',
      minimumOrderQuantity: 1,
      serialNumberRequired: false,
      lotNumberRequired: false,
      description: 'CAD e2e fixture part (safe to delete)',
    },
  });
  expect(created.ok()).toBeTruthy();
  const partId = (await created.json()).id;
  expect(partId).toBeGreaterThan(0);
  return { api, token, partId };
}

/** Open the CAD editor for the fixture part, creating the model on first use. */
export async function openEditor(page: Page, partId: number) {
  await page.goto(`/#/parts/${partId}/cad`);
  await page.waitForLoadState('domcontentloaded');
  const create = page.locator('[data-testid="cad-create-button"]');
  const open = page.locator('[data-testid="open-editor"]');
  await expect(create.or(open)).toBeVisible({ timeout: 10_000 });
  if (await create.isVisible()) await create.click();
  else await open.click();
  await page.waitForURL(/\/parts\/\d+\/cad\/editor/, { timeout: 10_000 });
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
}

export async function openFileTab(page: Page) {
  await page.locator('[data-testid="tab-file"]').click();
}

export async function ensureCheckedOut(page: Page) {
  await openFileTab(page);
  const checkin = page.locator('[data-testid="action-checkin"]');
  if (!(await checkin.isEnabled())) {
    await page.locator('[data-testid="action-checkout"]').click();
    await expect(checkin).toBeEnabled({ timeout: 10_000 });
  }
}

/** Features-tab Sketch action → pick-plane mode → XY datum via debug hook. */
export async function enterSketchOnXY(page: Page) {
  await ensureCheckedOut(page);
  await page.locator('[data-testid="tab-features"]').click();
  await page.locator('[data-testid="action-sketch"]').click();
  await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
  await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible({ timeout: 10_000 });
  await waitForCameraSettled(page);
}

/** Sketch entry tweens the camera to the plane; clicks issued mid-tween map
 * to drifting sketch coords. Wait until two projections 200ms apart agree. */
export async function waitForCameraSettled(page: Page) {
  const probe = () => page.evaluate(() => {
    const cam = (window as any).__cadCamera;
    if (!cam) return null;
    const a = cam.worldToScreen(0, 0, 0), b = cam.worldToScreen(10, 10, 0);
    return [a.x, a.y, b.x, b.y].map((v: number) => Math.round(v * 10) / 10).join(',');
  });
  let prev = await probe();
  await expect.poll(async () => {
    await page.waitForTimeout(200);
    const next = await probe();
    const stable = next !== null && next === prev;
    prev = next;
    return stable;
  }, { timeout: 10_000 }).toBe(true);
}

/** Screen position of an XY-plane sketch point (sketch coords = world x/y).
 * Clicks that must hit committed geometry should aim here, not at the raw
 * click that drew it — grid snapping moves entities a few pixels. */
export async function sketchToScreen(page: Page, x: number, y: number): Promise<[number, number]> {
  const p = await page.evaluate(([px, py]) => (window as any).__cadCamera.worldToScreen(px, py, 0), [x, y]);
  return [p.x, p.y];
}

export async function exitSketch(page: Page) {
  await page.locator('[data-testid="exit-sketch"]').click();
  await expect(page.locator('[data-testid="sketch-toolbar"]')).not.toBeVisible({ timeout: 10_000 });
}

/** The MAIN viewer canvas (`.first()` skips the nav-cube canvas). */
export function viewerCanvas(page: Page) {
  return page.locator('[data-testid="cad-viewer"] canvas').first();
}

export async function canvasCenter(page: Page): Promise<{ cx: number; cy: number }> {
  const box = (await viewerCanvas(page).boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Activate a sketch tool via its ribbon group's split-button menu.
 * Group is one of: primitives, circles, shapes, edit, transform. */
export async function pickTool(page: Page, group: string, tool: string) {
  await page.locator(`[data-testid="group-${group}-chevron"]`).click();
  const item = page.locator(`[data-testid="tool-${tool}"]`);
  await item.click();
  // The mat-menu backdrop can swallow the NEXT canvas click while the close
  // animation runs — wait for the menu to fully detach.
  await expect(item).toBeHidden({ timeout: 5_000 });
  await page.waitForTimeout(250);
}

/** Click a sequence of canvas points with a settle pause after each (the
 * per-click solve commit is async). */
export async function clickSequence(page: Page, points: Array<[number, number]>, settleMs = 150) {
  for (const [x, y] of points) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(settleMs);
  }
}

/** Draw a closed rectangle with the LINE tool around the canvas center.
 * Returns the four corner screen coords (later clicks can re-target the
 * same sketch points — the camera does not move in sketch mode). */
export async function drawClosedRectangle(page: Page, half = 60): Promise<Array<[number, number]>> {
  await pickTool(page, 'primitives', 'line');
  const { cx, cy } = await canvasCenter(page);
  const corners: Array<[number, number]> = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  await clickSequence(page, [...corners, corners[0]]);
  await page.keyboard.press('Escape');
  return corners;
}

export async function sketchEntities(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__cadSketch?.entities ?? []);
}

export async function sketchConstraints(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__cadSketch?.constraints ?? []);
}

export async function sketchEntityCount(page: Page, kind: string): Promise<number> {
  return page.evaluate(
    (k) => ((window as any).__cadSketch?.entities ?? []).filter((e: any) => e.kind === k).length,
    kind,
  );
}

/** Distance between two sketch points by entity id, measured in the live
 * entity model (sketch units == mm). */
export async function pointDistance(page: Page, aId: string, bId: string): Promise<number> {
  return page.evaluate(([a, b]) => {
    const ents = (window as any).__cadSketch?.entities ?? [];
    const pa = ents.find((e: any) => e.id === a), pb = ents.find((e: any) => e.id === b);
    if (!pa || !pb) return NaN;
    return Math.hypot(pb.x - pa.x, pb.y - pa.y);
  }, [aId, bId]);
}

/** Feature-tree row count (origin included). */
export function featureRows(page: Page) {
  return page.locator('[data-testid="feature-tree-row"]');
}

/** Extrude the current closed-profile sketch by `depth`; waits for sketch
 * exit + the new feature row. */
export async function extrudeSketch(page: Page, depth = 10) {
  const before = await featureRows(page).count();
  await page.locator('[data-testid="extrude-button"]').click();
  const input = page.locator('[data-testid="extrude-input"]:visible').first();
  await input.fill(String(depth));
  await page.locator('[data-testid="extrude-apply"]:visible').first().click();
  await expect(page.locator('[data-testid="sketch-toolbar"]')).not.toBeVisible({ timeout: 15_000 });
  await expect(featureRows(page)).toHaveCount(before + 1, { timeout: 20_000 });
}

/** Solid body face/edge data from the app debug hook. */
export async function geometrySummary(page: Page): Promise<{ faces: number; edges: number } | null> {
  return page.evaluate(() => {
    const g = (window as any).__cadApp?.geometry;
    if (!g) return null;
    return { faces: g.faces?.length ?? 0, edges: g.topology?.edges?.length ?? 0 };
  });
}
