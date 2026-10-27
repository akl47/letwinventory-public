// REQ 933/934 — "Add part" in an assembly: empty-assembly call-to-action,
// origin pick, orientation control, and insertion with a non-identity
// orientation. Serial — the second test builds on the assembly the first sets
// up. Uses a FRESH empty assembly (no child inserted) so the CTA is exercised.
import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { createFixturePart } from './helpers';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token = '';
let ASM_PART_ID = 0;
let ASM_MODEL_ID = 0;

test.beforeAll(async () => {
  // Reuse the fixture helper only to get an authed api context + a spare part;
  // then create the Assembly-category host part the assembly model needs.
  const base = await createFixturePart('addpart');
  api = base.api;
  token = base.token;
  const cats = await (await api.get('/api/inventory/part/categories', {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const asmCat = cats.find((c: any) => c.name === 'Assembly');
  expect(asmCat).toBeTruthy();
  const created = await api.post('/api/inventory/part', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `E2E CAD addpart asm ${Date.now() % 1_000_000_000}`,
      revision: '01', internalPart: true, partCategoryID: asmCat.id, vendor: 'E2E',
      minimumOrderQuantity: 1, serialNumberRequired: false, lotNumberRequired: false,
      description: 'CAD e2e add-part assembly fixture (safe to delete)',
    },
  });
  expect(created.ok()).toBeTruthy();
  ASM_PART_ID = (await created.json()).id;
  const res = await api.post(`/api/design/assembly/by-part/${ASM_PART_ID}`, {
    headers: { Authorization: `Bearer ${token}` }, data: {},
  });
  expect(res.ok()).toBeTruthy();
  ASM_MODEL_ID = (await res.json()).id;
});

test.afterAll(async () => { await api?.dispose(); });

const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

async function openAsmCheckedOut(page: Page) {
  await page.goto(`/#/parts/${ASM_PART_ID}/assembly/editor`);
  await page.locator('[data-testid="cad-hud-ready"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="tab-file"]').click();
  const checkin = page.locator('[data-testid="action-checkin"]');
  if (!(await checkin.isEnabled())) {
    await page.locator('[data-testid="action-checkout"]').click();
    await expect(checkin).toBeEnabled({ timeout: 10_000 });
  }
  await page.locator('[data-testid="tab-assembly"]').click();
}

test('empty assembly shows the Add-part CTA and it arms the origin pick', async ({ page }) => {
  test.setTimeout(120_000);
  await openAsmCheckedOut(page);

  const cta = page.locator('[data-testid="asm-empty-cta"]');
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // Clicking the CTA enters pick-child-origin: the mode-prompt appears and the
  // CTA (idle-only) hides.
  await page.locator('[data-testid="asm-empty-cta-add"]').click();
  await expect(page.locator('[data-testid="mode-prompt"]')).toBeVisible({ timeout: 5_000 });
  await expect(cta).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__cadApp?.mode)).toBe('pick-child-origin');

  // Cancel returns to idle and restores the CTA.
  await page.locator('[data-testid="mode-prompt"] button').click();
  await expect(cta).toBeVisible({ timeout: 5_000 });
});

test('Add part → pick origin → set orientation → insert with a non-identity quaternion', async ({ page }) => {
  test.setTimeout(120_000);
  await openAsmCheckedOut(page);

  // Arm the origin pick from the ribbon button, then pick the assembly origin
  // datum via the debug selection hook (→ origin [0,0,0], grounded).
  await page.locator('[data-testid="asm-action-new-part"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__cadApp?.mode)).toBe('pick-child-origin');
  await page.evaluate(() => (window as any).__cadSetSelected('datum:origin'));

  // The New CAD part dialog opens with the orientation control.
  const map = page.locator('[data-testid="npd-orient-map"]');
  await expect(map).toBeVisible({ timeout: 10_000 });
  await expect(map).toHaveText('+X→+X · +Y→+Y · +Z→+Z');

  // Rotate 90° about assembly X — the axis mapping updates.
  await page.locator('[data-testid="npd-rot-x"]').click();
  await expect(map).toHaveText('+X→+X · +Y→+Z · +Z→−Y');

  const before = await page.evaluate(async ([id, tok]) => {
    const r = await fetch(`/api/design/cad-model/by-part/${id}`, { headers: { Authorization: `Bearer ${tok}` } });
    const arr = await r.json();
    const m = Array.isArray(arr) ? arr[0] : arr;
    return (m?.assemblyDoc?.instances ?? []).length;
  }, [ASM_PART_ID, token] as const);

  await page.locator('[data-testid="npd-create"]').click();

  // The new instance lands on the assembly with the chosen (non-identity)
  // orientation. Poll the stored assembly doc.
  await expect.poll(async () => {
    const res = await api.get(`/api/design/cad-model/by-part/${ASM_PART_ID}`, auth());
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : arr;
    return (m?.assemblyDoc?.instances ?? []).length;
  }, { timeout: 30_000 }).toBe(before + 1);

  const quat = await (async () => {
    const res = await api.get(`/api/design/cad-model/by-part/${ASM_PART_ID}`, auth());
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : arr;
    const insts = m?.assemblyDoc?.instances ?? [];
    return insts[insts.length - 1]?.placement?.quaternion ?? [0, 0, 0, 1];
  })();
  // 90° about X ⇒ quaternion ≈ [0.707, 0, 0, 0.707], clearly not identity.
  expect(Math.abs(quat[0])).toBeGreaterThan(0.5);
  expect(Math.abs(quat[3])).toBeLessThan(0.99);
});
