import { test, expect, request as pwRequest, Page, APIRequestContext } from '@playwright/test';

// ───────────────────────────────────────────────────────────────────────────
// E2E coverage for the Part CAD Modeler — rewritten for the current UI:
//   - VCS working-copy model (checkout / checkin / draft-branch → release-to-main)
//     instead of the original in-place draft→review→released revision flow.
//   - Ribbon tabs (File / Features / Sketch); sketching starts from the
//     Features-tab "Sketch" action → pick a plane (no per-datum New Sketch button).
//   - 3D-always sketching: clicks land on the Three.js viewer canvas, not an
//     SVG sketch canvas.
//
// A FRESH PART is created per run via the API (test-login → POST /api/inventory/part)
// so releasing at the end can permanently lock its model without polluting
// later runs. Requires the backend at /api via the dev-server proxy.
//
// Window debug hooks (set in CadEditorComponent in non-prod builds):
//   window.__cadApp         — { mode, featureTree, doc, selected, geometry }
//   window.__cadSketch      — active sketch's entity-model state ({ entities, constraints })
//   window.__cadSetSelected(id) — programmatic selection (avoids raycaster ambiguity)
// ───────────────────────────────────────────────────────────────────────────

let PART_ID = 0;
let api: APIRequestContext;

test.beforeAll(async () => {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4201';
  api = await pwRequest.newContext({ baseURL });
  const login = await api.post('/api/auth/google/test-login', { data: { email: 'e2e@test.local' } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = await login.json();
  const created = await api.post('/api/inventory/part', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      name: `E2E CAD ${Date.now() % 1_000_000_000}`,
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
  PART_ID = (await created.json()).id;
  expect(PART_ID).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await api?.dispose();
});

async function openCadTab(page: Page) {
  await page.goto(`/#/parts/${PART_ID}/cad`);
  await page.waitForLoadState('domcontentloaded');
}

/** Open the editor: create the CAD model on first use, or open the existing one. */
async function openEditor(page: Page) {
  await openCadTab(page);
  const create = page.locator('[data-testid="cad-create-button"]');
  const open = page.locator('[data-testid="open-editor"]');
  await expect(create.or(open)).toBeVisible({ timeout: 10_000 });
  if (await create.isVisible()) await create.click();
  else await open.click();
  await page.waitForURL(/\/parts\/\d+\/cad\/editor/, { timeout: 10_000 });
  // Footer HUD renders once the editor shell is up (kernel not required).
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
}

/** Working-copy buttons live on the File tab. */
async function openFileTab(page: Page) {
  await page.locator('[data-testid="tab-file"]').click();
}

/** Check the working copy out to the e2e user if it isn't already. */
async function ensureCheckedOut(page: Page) {
  await openFileTab(page);
  const checkin = page.locator('[data-testid="action-checkin"]');
  if (!(await checkin.isEnabled())) {
    await page.locator('[data-testid="action-checkout"]').click();
    await expect(checkin).toBeEnabled({ timeout: 10_000 });
  }
}

/** Features-tab Sketch action → pick-plane mode → select the XY datum. */
async function enterSketchOnXY(page: Page) {
  await ensureCheckedOut(page);
  await page.locator('[data-testid="tab-features"]').click();
  await page.locator('[data-testid="action-sketch"]').click();
  await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
  await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible({ timeout: 10_000 });
}

/** Activate the Line tool via the primitives split-button menu. */
async function activateLineTool(page: Page) {
  await page.locator('[data-testid="group-primitives-chevron"]').click();
  await page.locator('[data-testid="tool-line"]').click();
}

/** The MAIN viewer canvas — `.first()` because the nav-cube is a second,
 * smaller Three.js canvas inside the same viewer container. */
function viewerCanvas(page: Page) {
  return page.locator('[data-testid="cad-viewer"] canvas').first();
}

/** Draw a closed rectangle with the line tool on the viewer canvas. */
async function drawClosedRectangle(page: Page) {
  await activateLineTool(page);
  const canvas = viewerCanvas(page);
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const corners: Array<[number, number]> = [
    [cx - 60, cy - 60],
    [cx + 60, cy - 60],
    [cx + 60, cy + 60],
    [cx - 60, cy + 60],
    [cx - 60, cy - 60], // back to start — closes the loop
  ];
  for (const [x, y] of corners) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(150); // let the async per-click solve commit
  }
  await page.keyboard.press('Escape');
}

/** Count active-sketch entities of a kind via the debug hook (entity model). */
async function sketchEntityCount(page: Page, kind: string): Promise<number> {
  return page.evaluate(
    (k) => ((window as any).__cadSketch?.entities ?? []).filter((e: any) => e.kind === k).length,
    kind,
  );
}

test.describe('CAD module routing and shell', () => {
  test('version-history view loads at /parts/:id/cad', async ({ page }) => {
    await openCadTab(page);
    await expect(page.locator('[data-testid="cad-tab"]')).toBeVisible({ timeout: 10_000 });
  });

  test('empty state offers Create CAD; creating opens the editor on a draft branch', async ({ page }) => {
    await openEditor(page);
    expect(page.url()).toMatch(/\/parts\/\d+\/cad\/editor/);
    // New models start on an auto-created draft branch, not main.
    await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText(/draft/i);
  });
});

test.describe('CAD editor initial state', () => {
  test('a fresh CAD model resolves seven origin datums', async ({ page }) => {
    await openEditor(page);
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__cadApp?.geometry?.datums?.length ?? null),
        { timeout: 15_000 },
      )
      .toBe(7);
  });

  test('the feature tree lists exactly the origin feature', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('[data-testid="feature-tree-row"]')).toHaveCount(1);
  });
});

test.describe('Sketch entry (Features tab → pick plane)', () => {
  test('Sketch action + picking the XY datum enters sketch mode', async ({ page }) => {
    await openEditor(page);
    await enterSketchOnXY(page);
    await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible();
    // Ribbon switches to the Sketch tab while a sketch is active.
    await expect(page.locator('[data-testid="tab-sketch"]')).toBeVisible();
  });
});

test.describe('Sketch tools', () => {
  test('Point tool places a point at the click location', async ({ page }) => {
    await openEditor(page);
    await enterSketchOnXY(page);
    await page.locator('[data-testid="group-primitives-chevron"]').click();
    await page.locator('[data-testid="tool-point"]').click();
    const box = (await viewerCanvas(page).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => sketchEntityCount(page, 'point'), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2); // origin + the placed point
  });

  test('Line tool chains clicks into a closed 4-line loop', async ({ page }) => {
    await openEditor(page);
    await enterSketchOnXY(page);
    await drawClosedRectangle(page);
    await expect.poll(() => sketchEntityCount(page, 'line'), { timeout: 5_000 }).toBe(4);
  });
});

test.describe('Extrude', () => {
  test('Extrude button appears only once the sketch has a closed profile', async ({ page }) => {
    await openEditor(page);
    await enterSketchOnXY(page);
    await expect(page.locator('[data-testid="extrude-button"]')).not.toBeVisible();
    await drawClosedRectangle(page);
    await expect(page.locator('[data-testid="extrude-button"]')).toBeVisible({ timeout: 5_000 });
  });

  test('Extruding a closed profile adds a feature and exits sketch mode', async ({ page }) => {
    await openEditor(page);
    const before = await page.locator('[data-testid="feature-tree-row"]').count();
    await enterSketchOnXY(page);
    await drawClosedRectangle(page);
    await page.locator('[data-testid="extrude-button"]').click();
    const input = page.locator('[data-testid="extrude-input"]:visible').first();
    await input.fill('10');
    await page.locator('[data-testid="extrude-apply"]:visible').first().click();
    await expect(page.locator('[data-testid="sketch-toolbar"]')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="feature-tree-row"]')).toHaveCount(before + 1, { timeout: 10_000 });
  });
});

test.describe('Full-screen toggle', () => {
  test('toggling full-screen hides the app chrome', async ({ page }) => {
    await openEditor(page);
    const header = page.locator('mat-toolbar.nav-header');
    await expect(header).toBeVisible();
    await page.locator('[data-testid="fullscreen-toggle"]').click();
    await expect(header).not.toBeVisible();
    await page.locator('[data-testid="fullscreen-toggle"]').click();
    await expect(header).toBeVisible();
  });
});

// Runs LAST: releasing archives the draft branch and permanently locks the
// released revision — the fixture part is disposable, so that's fine.
test.describe('Branch release workflow (VCS model)', () => {
  test('check in then Release lands on main as a locked numeric revision', async ({ page }) => {
    await openEditor(page);
    await ensureCheckedOut(page);

    // Check in the working copy (dialog collects a message).
    await openFileTab(page);
    await page.locator('[data-testid="action-checkin"]').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').fill('e2e: geometry for release');
    await dialog.getByRole('button', { name: 'Check in' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // A clean, checked-in draft branch can self-service release onto main.
    const release = page.locator('[data-testid="action-release-main"]');
    await expect(release).toBeEnabled({ timeout: 15_000 });
    await release.click();

    // Released: working copy switches to main, revision minted, editor read-only.
    await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText(/main/i, { timeout: 15_000 });
    await expect(page.locator('[data-testid="revision-badge"]')).toContainText(/01/);
    await expect(page.locator('[data-testid="readonly-banner"]')).toBeVisible();
  });
});
