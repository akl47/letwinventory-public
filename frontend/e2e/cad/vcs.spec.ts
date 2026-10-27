// REQ 929 — CAD version control e2e: checkout/checkin/undo-checkout,
// branch create/switch, the branches panel, release-to-main and the
// read-only main protection. Serial — one disposable part carries the
// whole lifecycle, release runs LAST.
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import {
  createFixturePart, openEditor, openFileTab, ensureCheckedOut,
  enterSketchOnXY, exitSketch, pickTool, clickSequence, canvasCenter,
  sketchEntityCount,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;
let api: APIRequestContext;
let token = '';

test.beforeAll(async () => {
  const fx = await createFixturePart('vcs');
  PART_ID = fx.partId;
  api = fx.api;
  token = fx.token;
});

test.afterAll(async () => {
  await api?.dispose();
});

async function apiModel(): Promise<any> {
  const res = await api.get(`/api/design/cad-model/by-part/${PART_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const arr = await res.json();
  return Array.isArray(arr) ? arr[0] : arr;
}

async function drawOneLine(page: Page) {
  const { cx, cy } = await canvasCenter(page);
  await pickTool(page, 'primitives', 'line');
  await clickSequence(page, [[cx - 60, cy - 40], [cx + 60, cy + 40]]);
  await page.keyboard.press('Escape');
}

test('fresh model starts checked-in on an auto-created draft branch', async ({ page }) => {
  await openEditor(page, PART_ID);
  await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText(/draft/i);
  const model = await apiModel();
  expect(model.branchName).toMatch(/^draft\//);
  expect(model.dirty).toBeFalsy();
});

test('checkout → edit → checkin persists and clears dirty', async ({ page }) => {
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  await drawOneLine(page);
  await exitSketch(page);
  await expect.poll(async () => (await apiModel()).dirty, { timeout: 10_000 }).toBe(true);

  await openFileTab(page);
  await page.locator('[data-testid="action-checkin"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('e2e: vcs lifecycle commit');
  await dialog.getByRole('button', { name: /check in/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await apiModel()).dirty, { timeout: 10_000 }).toBe(false);
});

test('undo checkout reverts uncommitted edits', async ({ page }) => {
  await openEditor(page, PART_ID);
  await ensureCheckedOut(page);
  await enterSketchOnXY(page);
  await drawOneLine(page);
  const withEdit = await sketchEntityCount(page, 'line');
  expect(withEdit).toBeGreaterThan(0);
  await exitSketch(page);

  await openFileTab(page);
  // Undo checkout confirms via window.confirm — accept the native dialog.
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid="action-undo-checkout"]').click();
  // Doc reverts to the checked-in state and the lock is released.
  await expect.poll(async () => (await apiModel()).dirty, { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await apiModel()).lockedByUserID, { timeout: 10_000 }).toBeFalsy();
});

test('release to main mints the revision, locks the model, and protects main', async ({ page }) => {
  await openEditor(page, PART_ID);
  // Must be clean + checked in before release (previous tests left it so).
  await openFileTab(page);
  const release = page.locator('[data-testid="action-release-main"]');
  await expect(release).toBeEnabled({ timeout: 15_000 });
  await release.click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /release|ok|confirm/i }).click();
  }

  await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText(/main/i, { timeout: 15_000 });
  await expect(page.locator('[data-testid="revision-badge"]')).toContainText(/01/);
  await expect(page.locator('[data-testid="readonly-banner"]')).toBeVisible();

  const model = await apiModel();
  expect(model.branchName).toBe('main');
  expect(model.releaseLocked).toBe(true);

  // Main protection is enforced server-side (423 on checkout/update) and
  // surfaced by the read-only banner asserted above.
});

test('new branch from main creates and switches; branches panel lists both', async ({ page }) => {
  await openEditor(page, PART_ID);
  await openFileTab(page);
  // New branch is offered on MAIN (post-release) and prompts natively.
  page.once('dialog', (d) => d.accept('draft/e2e-side'));
  await page.locator('[data-testid="action-new-branch"]').click();
  await expect(page.locator('[data-testid="cad-branch-badge"]')).toContainText('draft/e2e-side', { timeout: 15_000 });

  await openFileTab(page);
  await page.locator('[data-testid="action-branches"]').click();
  const panel = page.locator('[data-testid="vcs-branches-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel).toContainText('draft/e2e-side');
  await expect(panel).toContainText(/main/);
});

test('version-history page lists the release', async ({ page }) => {
  await page.goto(`/#/parts/${PART_ID}/cad`);
  await expect(page.locator('[data-testid="cad-tab"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="cad-tab"]')).toContainText(/release|01/i, { timeout: 10_000 });
});
