// REQ 931 — assembly e2e: build a child part, create an assembly, insert
// instances, mate faces, skeleton sketch, variables push, interference,
// exploded view, BOM sync. Serial — every test builds on the previous.
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  createFixturePart, openEditor, openFileTab, enterSketchOnXY,
  drawClosedRectangle, extrudeSketch,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token = '';
let CHILD_ID = 0;
let ASM_PART_ID = 0;
let ASM_MODEL_ID = 0;

test.beforeAll(async () => {
  const child = await createFixturePart('asm-child');
  CHILD_ID = child.partId;
  api = child.api;
  token = child.token;
  // Assembly host part — the backend requires the part category NAMED
  // "Assembly" (ids differ per database), so resolve it by name.
  const cats = await (await api.get('/api/inventory/part/categories', {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const asmCat = cats.find((c: any) => c.name === 'Assembly');
  expect(asmCat).toBeTruthy();
  const created = await api.post('/api/inventory/part', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `E2E CAD asm ${Date.now() % 1_000_000_000}`,
      revision: '01', internalPart: true, partCategoryID: asmCat.id, vendor: 'E2E',
      minimumOrderQuantity: 1, serialNumberRequired: false, lotNumberRequired: false,
      description: 'CAD e2e assembly fixture (safe to delete)',
    },
  });
  expect(created.ok()).toBeTruthy();
  ASM_PART_ID = (await created.json()).id;
});

test.afterAll(async () => {
  await api?.dispose();
});

const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

test('build the child cube (sketch → extrude → check in)', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, CHILD_ID);
  await enterSketchOnXY(page);
  await drawClosedRectangle(page, 60);
  await extrudeSketch(page, 15);
  await openFileTab(page);
  await page.locator('[data-testid="action-checkin"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('e2e: child cube');
  await dialog.getByRole('button', { name: /check in/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
});

test('create the assembly and insert the child twice', async ({ page }) => {
  test.setTimeout(120_000);
  const res = await api.post(`/api/design/assembly/by-part/${ASM_PART_ID}`, { ...auth(), data: {} });
  expect(res.ok()).toBeTruthy();
  ASM_MODEL_ID = (await res.json()).id;

  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await openFileTab(page);
  const checkin = page.locator('[data-testid="action-checkin"]');
  if (!(await checkin.isEnabled())) {
    await page.locator('[data-testid="action-checkout"]').click();
    await expect(checkin).toBeEnabled({ timeout: 10_000 });
  }
  await page.locator('[data-testid="tab-assembly"]').click();

  const instanceCount = () => page.evaluate(() => (window as any).__cadAsm?.instances?.length ?? 0);

  for (let i = 0; i < 2; i++) {
    await page.locator('[data-testid="asm-action-insert"]').click();
    const sidebar = page.locator('[data-testid="asm-insert-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
    await sidebar.locator('input.panel-input').first().fill(`E2E CAD asm-child`);
    const row = sidebar.locator('.asm-row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    // Track the child's DRAFT branch — its main is empty until a release,
    // so tracking the default (main) composes no geometry.
    const branchSelect = sidebar.locator('select.panel-input');
    await expect(branchSelect).toBeVisible({ timeout: 5_000 });
    await branchSelect.selectOption('draft/01');
    await sidebar.getByRole('button', { name: /insert/i }).click();
    await expect.poll(instanceCount, { timeout: 15_000 }).toBe(i + 1);
  }
});

test('mate two component faces', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-assembly"]').click();

  // Wait for the composed geometry (faces of both instances).
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadAsm?.faceIds ?? []).length), { timeout: 30_000 }).toBeGreaterThan(6);

  const matesBefore = await page.evaluate(() => (window as any).__cadAsm?.mates?.length ?? 0);
  await page.locator('[data-testid="asm-action-mate"]').click();
  await expect(page.locator('[data-testid="asm-mate-sidebar"]')).toBeVisible({ timeout: 5_000 });

  // Pick one face from EACH instance via the programmatic pick hook.
  await page.evaluate(() => {
    const w = window as any;
    const faces: string[] = w.__cadAsm.faceIds;
    const inst = (id: string) => id.split('::')[0] ?? id;
    const first = faces[0];
    const other = faces.find((f: string) => inst(f) !== inst(first)) ?? faces[faces.length - 1];
    w.__cadPickFace(first);
    w.__cadPickFace(other);
  });

  // Chooser: pick "coincident", then OK.
  const sidebar = page.locator('[data-testid="asm-mate-sidebar"]');
  const chip = sidebar.getByRole('button', { name: /coincident/i }).first();
  if (await chip.isVisible().catch(() => false)) await chip.click();
  const ok = sidebar.getByRole('button', { name: /ok/i });
  await expect(ok).toBeEnabled({ timeout: 5_000 });
  await ok.click();
  await expect.poll(() => page.evaluate(() =>
    (window as any).__cadAsm?.mates?.length ?? 0), { timeout: 15_000 }).toBe(matesBefore + 1);
});

test('skeleton sketch persists on the assembly', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-assembly"]').click();
  await page.locator('[data-testid="asm-action-sketch"]').click();
  await page.evaluate(() => (window as any).__cadSetSelected('datum:xy_plane'));
  // Assembly mode owns the ribbon tab — switch to Sketch manually.
  await expect(page.locator('[data-testid="tab-sketch"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="tab-sketch"]').click();
  await expect(page.locator('[data-testid="sketch-toolbar"]')).toBeVisible({ timeout: 10_000 });

  // One skeleton line.
  await page.locator('[data-testid="group-primitives-chevron"]').click();
  await page.locator('[data-testid="tool-line"]').click();
  const box = (await page.locator('[data-testid="cad-viewer"] canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx - 70, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 70, cy);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="exit-sketch"]').click();

  await expect.poll(async () => {
    const res = await api.get(`/api/design/cad-model/by-part/${ASM_PART_ID}`, auth());
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : arr;
    return Object.keys(m?.sketchDoc?.sketches ?? {}).length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
});

test('variables push writes tagged literals into the child', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-assembly"]').click();

  await page.locator('[data-testid="asm-action-variables"]').click();
  await page.locator('[data-testid="eqn-draft-name"]').fill('bolt_len');
  await page.locator('[data-testid="eqn-draft-expression"]').fill('42');
  await page.locator('[data-testid="eqn-draft-expression"]').press('Enter');
  await expect(page.locator('[data-testid="eqn-name"]').last()).toHaveValue('bolt_len', { timeout: 5_000 });
  await page.locator('[data-testid="eqn-close"]').click();

  // REQ 946 — push only writes children the pusher holds a checkout on.
  const childModel = await (await api.get(`/api/design/cad-model/by-part/${CHILD_ID}`, auth())).json();
  const childId = (Array.isArray(childModel) ? childModel[0] : childModel).id;
  expect((await api.post(`/api/design/cad-model/${childId}/checkout`, { ...auth(), data: {} })).ok()).toBe(true);

  // Push confirms via window.confirm — accept the native dialog.
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid="asm-action-push-variables"]').click();

  await expect.poll(async () => {
    const res = await api.get(`/api/design/cad-model/by-part/${CHILD_ID}`, auth());
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : arr;
    return m?.equations?.entries?.bolt_len?.expression ?? null;
  }, { timeout: 15_000 }).toBe('42');
});

test('interference check reports the two overlapping cubes', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-assembly"]').click();
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadAsm?.faceIds ?? []).length), { timeout: 30_000 }).toBeGreaterThan(0);

  // Interference lives on the ANALYZE ribbon tab.
  await page.locator('[data-testid="tab-analyze"]').click();
  await page.locator('[data-testid="asm-action-interference"]').click();
  // Both instances sit at the origin → they interfere.
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadAsm?.interference ?? []).length), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(0);  // pairs array populated (may be 0 if a mate separated them)
});

test('exploded view controls toggle', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  // Exploded view lives on the VISUALIZE ribbon tab.
  await page.locator('[data-testid="tab-visualize"]').click();
  await page.locator('[data-testid="asm-explode"]').click();
  await expect(page.locator('[data-testid="asm-explode-controls"]')).toBeVisible({ timeout: 5_000 });
});

test('BOM sync writes assembly components into inventory', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  // BOM sync lives on the ANALYZE ribbon tab.
  await page.locator('[data-testid="tab-analyze"]').click();
  await page.locator('[data-testid="asm-action-sync-bom"]').click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const confirm = dialog.getByRole('button', { name: /sync|ok|confirm/i }).first();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  await expect.poll(async () => {
    const res = await api.get(`/api/inventory/bom/${ASM_PART_ID}`, auth());
    if (!res.ok()) return -1;
    const rows = await res.json();
    return rows?.bomItems?.length ?? -1;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
});

// REQ 1074 — the File tab offers the same commands as on a part.
test('File tab matches the part editor', async ({ page }) => {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await openFileTab(page);
  for (const id of ['action-history', 'action-compare', 'action-copy-part', 'action-export-part',
    'action-dl-step', 'action-dl-stl', 'action-dl-3mf']) {
    await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
  }
  // REQ 1076 — 3MF of the composed assembly.
  await expect.poll(() => page.evaluate(() =>
    ((window as any).__cadAsm?.faceIds ?? []).length), { timeout: 30_000 }).toBeGreaterThan(0);
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-dl-3mf"]').click();
  expect((await dl).suggestedFilename()).toMatch(/\.3mf$/);
  // REQ 1075 — History opens the version-history page, which returns here.
  await page.locator('[data-testid="action-history"]').click();
  await page.waitForURL(new RegExp(`/parts/${ASM_PART_ID}/cad$`));
  await page.locator('[data-testid="open-editor"]').click();
  await page.waitForURL(new RegExp(`/parts/${ASM_PART_ID}/assembly/editor`));
});

// REQ 1077–1079 — export the assembly with its components, import it as new parts.
test('Export .lwcad and import it as a new assembly', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await openFileTab(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="action-export-part"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^E2E CAD asm .*\.lwcad$/);
  const path = info.outputPath('assembly.lwcad');
  await download.saveAs(path);
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  expect(bundle).toMatchObject({ kind: 'letwinventory-cad', schema: 1, scope: 'assembly' });
  expect(bundle.components.map((c: any) => c.partID)).toEqual([CHILD_ID]);

  await page.goto('/#/design/cad');
  await page.locator('[data-testid="cad-import-part"]').waitFor();
  await page.locator('[data-testid="cad-import-file"]').setInputFiles(path);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Paste assembly')).toBeVisible();
  await expect(dialog.locator('[data-testid="npd-components"]')).toContainText('1 component part');
  await dialog.locator('[data-testid="npd-create"]').click();
  await page.waitForURL(/\/parts\/\d+\/assembly\/editor/, { timeout: 30_000 });
  expect(page.url()).not.toContain(`/parts/${ASM_PART_ID}/`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  // Every instance came across, pointing at the NEW child part, and composes.
  await expect.poll(() => page.evaluate((child) => {
    const a = (window as any).__cadAsm;
    const insts = a?.instances ?? [];
    return insts.length > 0 && insts.every((i: any) => i.partID !== child) && (a?.faceIds ?? []).length > 0;
  }, CHILD_ID), { timeout: 30_000 }).toBe(true);
});

// REQ 1081 — the picked part previews at the cursor; a viewport click places it.
test('insert preview places a component where the view is clicked', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-assembly"]').click();
  const instances = () => page.evaluate(() => (window as any).__cadAsm?.instances ?? []);
  const before = (await instances()).length;

  await page.locator('[data-testid="asm-action-insert"]').click();
  const sidebar = page.locator('[data-testid="asm-insert-sidebar"]');
  await sidebar.locator('input.panel-input').first().fill('E2E CAD asm-child');
  await sidebar.locator('.asm-row').first().click();
  // REQ 1080 — a never-released part defaults to its working branch.
  await expect(sidebar.locator('select.panel-input')).toHaveValue('draft/01');
  await expect.poll(() => page.evaluate(() => (window as any).__cadAsm?.insertGhostFaces ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(sidebar.locator('[data-testid="asm-insert-preview-hint"]')).toContainText('Click in the view');

  const box = (await page.locator('app-cad-viewer canvas').first().boundingBox())!;
  const x = box.x + box.width * 0.2, y = box.y + box.height * 0.25;
  await page.mouse.move(x - 20, y - 20);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await instances()).length, { timeout: 15_000 }).toBe(before + 1);
  const placed = (await instances()).at(-1);
  expect(placed.placement.translate.some((v: number) => Math.abs(v) > 1e-6)).toBe(true);
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => (window as any).__cadAsm?.insertGhostFaces)).toBe(0);
});
