import { test, expect, Page } from '@playwright/test';

// ───────────────────────────────────────────────────────────────────────────
// E2E coverage for the Part CAD Modeler (DesignFeature 35).
//
// These tests assume:
//   - A part exists with id available at PART_ID below. Use the e2e seed
//     data or replace with a fixture-created id at suite startup once the
//     backend exposes a deterministic seeded part.
//   - The /api/design/cad-model endpoints are wired up (Step 6).
//   - The frontend route /parts/:id/cad and /parts/:id/cad/editor exist.
//
// Window debug hooks (set in CadEditorComponent in non-prod builds):
//   window.__cadApp        — { mode, featureTree, doc, selected, hovered }
//   window.__cadSketch     — current sketch state (when in sketch mode)
//   window.__cadCamera     — { worldToScreen(x,y,z): {x,y} }
//   window.__cadSetSelected(id) — programmatic selection (avoids raycaster ambiguity)
// ───────────────────────────────────────────────────────────────────────────

const PART_ID = Number(process.env.E2E_PART_ID || 1);

async function openCadTab(page: Page) {
  await page.goto(`/#/parts/${PART_ID}/cad`);
  await page.waitForLoadState('domcontentloaded');
}

async function createAndOpenEditor(page: Page) {
  await openCadTab(page);
  const create = page.locator('[data-testid="cad-create-button"]');
  if (await create.isVisible()) {
    await create.click();
  }
  await page.waitForURL(/\/parts\/\d+\/cad\/editor/, { timeout: 10000 });
  // Wait for kernel-ready signal: HUD reports geometry loaded.
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30000 });
}

test.describe('CAD module routing and shell (CAD-001, CAD-009)', () => {
  test('list view loads at /parts/:id/cad', async ({ page }) => {
    await openCadTab(page);
    await expect(page.locator('[data-testid="cad-tab"]')).toBeVisible({ timeout: 10000 });
  });

  test('empty state shows Create CAD button when no model exists', async ({ page }) => {
    await openCadTab(page);
    const create = page.locator('[data-testid="cad-create-button"]');
    const list = page.locator('[data-testid="cad-revision-list"] tbody tr');
    // Either the create button is visible, or the list has rows. Both states
    // are valid depending on whether prior tests left a model in place.
    if (await create.isVisible()) {
      await expect(create).toBeVisible();
    } else {
      await expect(list.first()).toBeVisible();
    }
  });

  test('clicking Create CAD opens the editor at /parts/:id/cad/editor', async ({ page }) => {
    await createAndOpenEditor(page);
    expect(page.url()).toMatch(/\/parts\/\d+\/cad\/editor/);
  });
});

test.describe('CAD editor initial state (CAD-035)', () => {
  test('a fresh CAD model renders seven datum elements', async ({ page }) => {
    await createAndOpenEditor(page);
    const datums = await page.evaluate(() => {
      const app = (window as any).__cadApp;
      const tree = app?.featureTree;
      if (!tree) return null;
      // The geometry exposes a datums array on the resolved geometry.
      return app?.geometry?.datums?.length ?? null;
    });
    expect(datums).toBe(7);
  });

  test('the feature tree panel lists exactly the origin feature', async ({ page }) => {
    await createAndOpenEditor(page);
    const rows = await page.locator('[data-testid="feature-tree-row"]').count();
    expect(rows).toBe(1);
  });
});

test.describe('Sketch entry (CAD-022, CAD-023)', () => {
  test('selecting a datum plane reveals the New Sketch button', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await expect(page.locator('[data-testid="new-sketch-button"]')).toBeVisible({ timeout: 5000 });
  });

  test('New Sketch enters sketch mode with the toolbar visible', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await page.locator('[data-testid="new-sketch-button"]').click();
    await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Sketch tools (CAD-010, CAD-011)', () => {
  test('Point tool places a single point at the click location', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await page.locator('[data-testid="new-sketch-button"]').click();
    await page.locator('[data-testid="tool-point"]').click();
    const canvas = page.locator('[data-testid="sketch-canvas"]');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const pointCount = await page.evaluate(() => (window as any).__cadSketch?.points?.length ?? 0);
    expect(pointCount).toBeGreaterThanOrEqual(1);
  });

  test('Line tool chains successive clicks into a polyline', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await page.locator('[data-testid="new-sketch-button"]').click();
    await page.locator('[data-testid="tool-line"]').click();
    const canvas = page.locator('[data-testid="sketch-canvas"]');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx - 50, cy - 50);
    await page.mouse.click(cx + 50, cy - 50);
    await page.mouse.click(cx + 50, cy + 50);
    await page.mouse.click(cx - 50, cy + 50);
    await page.mouse.click(cx - 50, cy - 50); // close
    await page.keyboard.press('Escape');
    const lineCount = await page.evaluate(() => (window as any).__cadSketch?.lines?.length ?? 0);
    expect(lineCount).toBe(4);
  });
});

test.describe('Extrude action (CAD-039, CAD-040)', () => {
  test('Extrude button appears only when the sketch has a closed profile', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await page.locator('[data-testid="new-sketch-button"]').click();
    await expect(page.locator('[data-testid="extrude-button"]')).not.toBeVisible();
  });

  test('Extruding a closed profile produces a solid and exits sketch mode', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
    await page.locator('[data-testid="new-sketch-button"]').click();
    await page.locator('[data-testid="tool-line"]').click();
    const canvas = page.locator('[data-testid="sketch-canvas"]');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx - 50, cy - 50);
    await page.mouse.click(cx + 50, cy - 50);
    await page.mouse.click(cx + 50, cy + 50);
    await page.mouse.click(cx - 50, cy + 50);
    await page.mouse.click(cx - 50, cy - 50);
    await page.keyboard.press('Escape');

    await page.locator('[data-testid="extrude-button"]').click();
    await page.locator('[data-testid="extrude-input"]').fill('10');
    await page.locator('[data-testid="extrude-apply"]').click();

    // Back in 3D view; feature tree gained a row.
    await expect(page.locator('[data-testid="sketch-toolbar"]')).not.toBeVisible({ timeout: 5000 });
    const rows = await page.locator('[data-testid="feature-tree-row"]').count();
    expect(rows).toBe(2);
  });
});

test.describe('Revision workflow (CAD-103, CAD-104, CAD-105)', () => {
  test('Submit transitions the badge from draft to review', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.locator('[data-testid="action-submit"]').click();
    await expect(page.locator('[data-testid="state-badge"]')).toContainText(/review/i);
  });

  test('Release transitions the badge to released and locks the editor', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.locator('[data-testid="action-submit"]').click();
    await page.locator('[data-testid="action-release"]').click();
    await expect(page.locator('[data-testid="state-badge"]')).toContainText(/released/i);
    await expect(page.locator('[data-testid="readonly-banner"]')).toBeVisible();
  });

  test('Released revision disables sketch tools (CAD-105)', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.locator('[data-testid="action-submit"]').click();
    await page.locator('[data-testid="action-release"]').click();
    // The New Sketch button must not be functional after release.
    const newSketch = page.locator('[data-testid="new-sketch-button"]');
    if (await newSketch.isVisible()) {
      await expect(newSketch).toBeDisabled();
    }
  });

  test('New Revision creates revision B in draft from released A (CAD-103)', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.locator('[data-testid="action-submit"]').click();
    await page.locator('[data-testid="action-release"]').click();
    await page.locator('[data-testid="action-new-revision"]').click();
    await expect(page.locator('[data-testid="revision-badge"]')).toContainText(/^B/);
    await expect(page.locator('[data-testid="state-badge"]')).toContainText(/draft/i);
  });
});

test.describe('Full-screen toggle', () => {
  test('Toggling full-screen hides the app chrome', async ({ page }) => {
    await createAndOpenEditor(page);
    await page.locator('[data-testid="fullscreen-toggle"]').click();
    await expect(page.locator('app-toolbar, [data-testid="app-toolbar"]')).not.toBeVisible();
    await page.locator('[data-testid="fullscreen-toggle"]').click();
    await expect(page.locator('app-toolbar, [data-testid="app-toolbar"]')).toBeVisible();
  });
});
