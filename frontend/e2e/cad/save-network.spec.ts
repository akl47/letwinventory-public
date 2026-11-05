// REQ 991 — the editor must never raise the "changed in another window or
// tab" conflict against its own session on a slow or flaky network.
// Save PUTs are intercepted: the request reaches the server (route.fetch),
// then the RESPONSE is delayed or dropped — exactly what a slow / dropping
// link does to the browser.
import { test, expect, Page, Route } from '@playwright/test';
import { createFixturePart, openEditor, enterSketchOnXY, pickTool, clickSequence, canvasCenter } from './helpers';

test.describe.configure({ mode: 'serial' });

let PART_ID = 0;

test.beforeAll(async () => {
  const fx = await createFixturePart('save-net');
  PART_ID = fx.partId;
  await fx.api.dispose();
});

const SAVE_URL = /\/api\/design\/cad-model\/\d+$/;
const CONFLICT_TEXT = 'changed in another window or tab';

interface SaveLog { inFlight: number; maxInFlight: number; statuses: number[]; lastBody: string; lastActivity: number }

/** Intercept content saves. `onResponse` decides what the browser sees once
 * the server has answered (delay, drop, pass through). */
async function interceptSaves(page: Page, onResponse: (n: number, route: Route, res: any) => Promise<void>): Promise<SaveLog> {
  const log: SaveLog = { inFlight: 0, maxInFlight: 0, statuses: [], lastBody: '', lastActivity: Date.now() };
  let n = 0;
  await page.route(SAVE_URL, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const i = ++n;
    log.inFlight++;
    log.lastActivity = Date.now();
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    log.lastBody = route.request().postData() ?? '';
    try {
      const res = await route.fetch();
      log.statuses.push(res.status());
      await onResponse(i, route, res);
    } finally {
      log.inFlight--;
      log.lastActivity = Date.now();
    }
  });
  return log;
}

async function drawLine(page: Page, a: [number, number], b: [number, number]) {
  await pickTool(page, 'primitives', 'line');
  await clickSequence(page, [a, b]);
  await page.keyboard.press('Escape');
}

const lineIds = (page: Page) => page.evaluate(() =>
  ((window as any).__cadSketch?.entities ?? []).filter((e: any) => e.kind === 'line').map((e: any) => e.id as string));

/** Wait for at least `minSaves` intercepted saves in total, then until none
 * is on the wire and none starts for a quiet period (> the 500 ms debounce). */
async function waitForSavesIdle(log: SaveLog, minSaves: number, quietMs = 2500) {
  await expect.poll(() => log.statuses.length + log.inFlight, { timeout: 15_000 }).toBeGreaterThanOrEqual(minSaves);
  await expect.poll(() => log.inFlight === 0 && Date.now() - log.lastActivity >= quietMs,
    { timeout: 30_000, intervals: [250] }).toBe(true);
}

test('slow save responses never overlap and raise no conflict', async ({ page }) => {
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  const { cx, cy } = await canvasCenter(page);
  // Every response arrives 1.5 s after the server answered — far longer than
  // the 500 ms save debounce, so edits keep landing while a save is in flight.
  const log = await interceptSaves(page, async (_i, route, res) => {
    await new Promise(r => setTimeout(r, 1500));
    await route.fulfill({ response: res });
  });

  await drawLine(page, [cx + 60, cy + 90], [cx + 170, cy + 130]);
  await drawLine(page, [cx + 60, cy - 40], [cx + 170, cy - 90]);
  await drawLine(page, [cx - 170, cy - 60], [cx - 60, cy - 120]);
  await drawLine(page, [cx - 170, cy + 60], [cx - 60, cy + 120]);
  await waitForSavesIdle(log, 2);

  expect(log.statuses.length).toBeGreaterThan(0);
  expect(log.statuses).not.toContain(409);
  expect(log.maxInFlight).toBe(1);
  await expect(page.getByText(CONFLICT_TEXT)).toHaveCount(0);
  // The last save carried every line drawn.
  const ids = await lineIds(page);
  expect(ids.length).toBeGreaterThanOrEqual(4);
  for (const id of ids) expect(log.lastBody).toContain(id);
});

test('a dropped save response the server applied recovers without the conflict banner', async ({ page }) => {
  await openEditor(page, PART_ID);
  await enterSketchOnXY(page);
  const { cx, cy } = await canvasCenter(page);
  // The FIRST save reaches the server and is applied, but the connection
  // drops before the browser gets the response.
  const log = await interceptSaves(page, async (i, route, res) => {
    if (i === 1) await route.abort('connectionreset');
    else await route.fulfill({ response: res });
  });

  await drawLine(page, [cx + 60, cy + 90], [cx + 170, cy + 130]);
  await waitForSavesIdle(log, 1);
  await drawLine(page, [cx - 170, cy - 60], [cx - 60, cy - 120]);
  await waitForSavesIdle(log, 2);

  expect(log.statuses.length).toBeGreaterThanOrEqual(2);
  expect(log.statuses).not.toContain(409);
  await expect(page.getByText(CONFLICT_TEXT)).toHaveCount(0);
  const ids = await lineIds(page);
  for (const id of ids) expect(log.lastBody).toContain(id);
});
