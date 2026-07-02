#!/usr/bin/env node
// E2E + kernel verification for the 3D-feature test cases.
//
// Drives the FULL stack over HTTP — login → create/reuse a part + CAD model per
// case → checkout → PUT featureTree+sketchDoc → regenerate (real OCCT kernel) →
// assert the geometry built. No psql / direct-DB access, so it runs anywhere the
// backend + kernel are reachable (local docker compose, or the CI kernel job).
//
// Exits non-zero on the first case that fails to regenerate or misses its
// expected geometry, so it can gate `run-tests.sh` and CI.
//
// Env: CAD_E2E_API (default http://localhost:3000), CAD_E2E_EMAIL
//      (default claude@letwin.co).
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const API = process.env.CAD_E2E_API || 'http://localhost:3000';
const EMAIL = process.env.CAD_E2E_EMAIL || 'claude@letwin.co';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Per-case expectation: minimum face count on the busiest body after regen.
// (Datum-only cases produce no body → 0.) Pulled from observed-correct output.
const EXPECT = {
  B01: 6, B02: 6, B14: 3, U01: 10, U07: 7, U09: 9, U10: 8,
  D01: 7, D06: 7, D10: 11, R01: 0, M01: 10, M04: 6,
};

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

async function api(method, route, token, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

// 1. Build the case docs (gen writes /tmp/3d-test-cases.json).
log('Generating 3D feature test cases…');
const gen = spawnSync('node', [path.join(REPO, 'scripts/gen-3d-test-part.mjs')], { encoding: 'utf8' });
if (gen.status !== 0) fail(`generator failed:\n${gen.stderr || gen.stdout}`);
const cases = JSON.parse(readFileSync('/tmp/3d-test-cases.json', 'utf8'));
log(`  ${cases.length} cases\n`);

// 2. Login.
const login = await api('POST', '/api/auth/google/test-login', null, { email: EMAIL });
const token = login.json.accessToken;
if (!token) fail(`login failed (${login.status}): ${JSON.stringify(login.json).slice(0, 200)}`);


// Existing CADTEST parts → reuse their models (idempotent across runs / CI).
const withCadRes = await api('GET', '/api/design/cad-model/parts-with-cad', token);
if (!Array.isArray(withCadRes.json)) fail(`parts-with-cad failed (${withCadRes.status}): ${JSON.stringify(withCadRes.json).slice(0, 200)}`);
const byName = new Map(withCadRes.json.filter(e => e && e.part).map(e => [e.part.name, { partID: e.partID, modelId: e.latestRevisionID }]));

let passed = 0;
const failures = [];
for (const c of cases) {
  const name = `CADTEST ${c.id}`;
  try {
    // Create or reuse the part + model.
    let rec = byName.get(name);
    if (!rec) {
      const part = await api('POST', '/api/inventory/part', token, {
        name, revision: '01', internalPart: true, partCategoryID: 1, vendor: 'Internal',
        minimumOrderQuantity: 1, serialNumberRequired: false, lotNumberRequired: false,
        description: `3D feature test case ${c.id} — ${c.title}`,
      });
      if (!part.json.id) throw new Error(`part create failed (${part.status}): ${JSON.stringify(part.json).slice(0, 160)}`);
      const model = await api('POST', `/api/design/cad-model/by-part/${part.json.id}`, token, { name: `${c.id} — ${c.title}` });
      if (!model.json.id) throw new Error(`model create failed (${model.status}): ${JSON.stringify(model.json).slice(0, 160)}`);
      rec = { partID: part.json.id, modelId: model.json.id };
    }

    // Checkout → inject doc → regenerate. A checkout conflict (locked by
    // another user) would otherwise surface as a confusing 423 on the PUT.
    const co = await api('POST', `/api/design/cad-model/${rec.modelId}/checkout`, token, {});
    if (co.status >= 400 && co.status !== 409) throw new Error(`checkout failed (${co.status}): ${JSON.stringify(co.json).slice(0, 160)}`);
    const put = await api('PUT', `/api/design/cad-model/${rec.modelId}`, token, { featureTree: c.featureTree, sketchDoc: c.sketchDoc });
    if (put.status !== 200) throw new Error(`PUT doc failed (${put.status}): ${JSON.stringify(put.json).slice(0, 160)}`);

    const regen = await api('POST', `/api/design/cad-model/${rec.modelId}/regenerate`, token, {});
    if (regen.json.errorMessage) throw new Error(`regen error: ${regen.json.errorMessage}`);
    const top = regen.json.errors;
    if (Array.isArray(top) && top.length) throw new Error(`kernel errors: ${top.join('; ')}`);
    const featErr = (regen.json.features || []).find(f => f.error);
    if (featErr) throw new Error(`feature ${featErr.featureId} failed: ${featErr.error}`);

    const maxFaces = Math.max(0, ...(regen.json.features || []).map(f => (f.faces || []).length));
    const want = EXPECT[c.id] ?? 0;
    if (maxFaces < want) throw new Error(`expected ≥${want} faces, got ${maxFaces}`);

    log(`  ✓ ${c.id.padEnd(5)} ${c.title.padEnd(24)} model ${String(rec.modelId).padEnd(4)} faces=${maxFaces}`);
    passed++;
  } catch (err) {
    log(`  ✗ ${c.id.padEnd(5)} ${c.title.padEnd(24)} ${err.message}`);
    failures.push(`${c.id}: ${err.message}`);
  }
}

log(`\n${passed}/${cases.length} cases verified against the live kernel.`);
if (failures.length) fail(`${failures.length} case(s) failed:\n  ${failures.join('\n  ')}`);
log('✓ All 3D feature cases regenerate through the OCCT kernel.');
