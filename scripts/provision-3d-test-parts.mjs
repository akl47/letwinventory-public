#!/usr/bin/env node
// Provision one Part + CAD model per 3D-feature test case (from
// /tmp/3d-test-cases.json, produced by gen-3d-test-part.mjs). Idempotent:
// reuses an existing `CADTEST <id>` part+model if present, else creates it.
//
// Emits /tmp/upd3d_all.sql (one UPDATE per model, injecting featureTree +
// sketchDoc) and /tmp/3d-models.json ([{id, modelId, partID}]). Run the SQL
// with psql, then regenerate each model.
import { readFileSync, writeFileSync } from 'fs';

const API = 'http://localhost:3000';
const cases = JSON.parse(readFileSync('/tmp/3d-test-cases.json', 'utf8'));

const login = await (await fetch(`${API}/api/auth/google/test-login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'claude@letwin.co' }),
})).json();
const TOKEN = login.accessToken;
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

// Existing CADTEST parts → reuse their models.
const existing = await (await fetch(`${API}/api/design/cad-model/parts-with-cad`, { headers: H })).json();
const byName = new Map(existing.map(e => [e.part.name, { partID: e.partID, modelId: e.latestRevisionID }]));

const models = [];
for (const c of cases) {
  const name = `CADTEST ${c.id}`;
  let rec = byName.get(name);
  if (rec) {
    console.log(`reuse  ${name}  → model ${rec.modelId}`);
  } else {
    const part = await (await fetch(`${API}/api/inventory/part`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ name, revision: '01', internalPart: true, partCategoryID: 1, vendor: 'Internal', minimumOrderQuantity: 1, serialNumberRequired: false, lotNumberRequired: false, description: `3D feature test case ${c.id} — ${c.title}` }),
    })).json();
    if (!part.id) { console.error(`FAILED part ${name}:`, JSON.stringify(part).slice(0, 200)); continue; }
    const model = await (await fetch(`${API}/api/design/cad-model/by-part/${part.id}`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: `${c.id} — ${c.title}` }),
    })).json();
    if (!model.id) { console.error(`FAILED model ${name}:`, JSON.stringify(model).slice(0, 200)); continue; }
    rec = { partID: part.id, modelId: model.id };
    console.log(`create ${name}  → part ${part.id} model ${model.id}`);
  }
  models.push({ id: c.id, title: c.title, modelId: rec.modelId, partID: rec.partID });
}

// Build the injection SQL.
const esc = (o) => JSON.stringify(o).replace(/'/g, "''");
let sql = '';
for (let i = 0; i < models.length; i++) {
  const c = cases.find(x => x.id === models[i].id);
  sql += `UPDATE "DesignCADModels" SET "featureTree"='${esc(c.featureTree)}'::jsonb, "sketchDoc"='${esc(c.sketchDoc)}'::jsonb, "updatedAt"=now() WHERE id=${models[i].modelId};\n`;
}
writeFileSync('/tmp/upd3d_all.sql', sql);
writeFileSync('/tmp/3d-models.json', JSON.stringify(models, null, 2));
console.log(`\nProvisioned ${models.length} models. SQL → /tmp/upd3d_all.sql, map → /tmp/3d-models.json`);
console.log('Models:', models.map(m => `${m.id}:${m.modelId}`).join(' '));
