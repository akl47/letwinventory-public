#!/usr/bin/env node
// Generate a CAD sketch document with ONE sketch per test case from
// docs/cad-system/cad-modeler/sketch-test-cases.md. Each sketch is named
// "<id> — <title>" so you can walk the sketch list and verify each case.
//
// Usage:
//   node scripts/gen-sketch-test-part.mjs            # writes /tmp/sketch-test-doc.json
//   node scripts/gen-sketch-test-part.mjs --out x.json
//
// It bundles the real frontend sketch lib (store.ts + sketchEditOps.ts) via
// esbuild and builds geometry with the actual helpers, so the schema is valid.
// External-reference cases (on-edge / dimension-to-edge / convert) need a base
// 3D body and are intentionally omitted here (documented in the catalog).

import { writeFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'frontend') + '/');
const { build } = require('esbuild');
const FRONT = path.join(REPO, 'frontend/src/app/cad/lib');
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : '/tmp/sketch-test-doc.json';

// Bundle store + ops + solver into one ESM module we can import. The solver
// is included so each sketch can be PRE-SOLVED before storage — constraint
// cases (coincident / tangent / dims / …) only look right once their geometry
// satisfies the constraint, so we run the real PlaneGCS solver here.
const entry = `${FRONT}/_genentry.ts`;
const fs = await import('fs');
fs.writeFileSync(entry,
  `export * from './store';\nexport * from './sketchEditOps';\nexport { solveSketch } from './solver';\nexport { SKETCH_CASES } from './test-cases/sketch-cases';\n`);
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
  outfile: '/tmp/_sketchlib.mjs', logLevel: 'error',
});
fs.unlinkSync(entry);
// PlaneGCS resolves its WASM alongside the bundle in Node — copy it there.
fs.copyFileSync(path.join(FRONT, '../vendor/planegcs/planegcs_dist/planegcs.wasm'), '/tmp/planegcs.wasm');
const L = await import(pathToFileURL('/tmp/_sketchlib.mjs').href);

const PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const sketches = {};
let seq = 1;
const ok = [], failed = [];

// mk(id, title, fn, opts?): fn(state, lib) -> final state. Per-case isolation.
// opts.hostId / opts.plane override the default front (XY) datum placement.
function mk(id, title, fn, opts = {}) {
  try {
    let s = L.emptySketchState();
    s = fn(s);
    if (!s || !Array.isArray(s.entities)) throw new Error('builder returned no state');
    const sid = `s${String(seq).padStart(3, '0')}_${id}`;
    sketches[sid] = { id: sid, hostId: opts.hostId || 'datum:xy_plane', name: `${id} — ${title}`, plane: opts.plane || PLANE, state: s, candidates: [], visible: false, createdAt: 1700000000000 + seq * 1000 };
    seq++; ok.push(id);
  } catch (e) { failed.push(`${id}: ${e.message}`); }
}
// mkRaw(id, title, state, opts?): store a hand-built state verbatim, bypassing
// the entity-model check + pre-solve. Used for the legacy-schema migration case
// whose state is the old `{points, lines, constraints}` shape (no `entities`).
function mkRaw(id, title, state, opts = {}) {
  const sid = `s${String(seq).padStart(3, '0')}_${id}`;
  sketches[sid] = { id: sid, hostId: opts.hostId || 'datum:xy_plane', name: `${id} — ${title}`, plane: opts.plane || PLANE, state, candidates: [], visible: false, createdAt: 1700000000000 + seq * 1000 };
  seq++; ok.push(id);
}
// Build every catalog case from the shared source of truth
// (frontend/src/app/cad/lib/test-cases/sketch-cases.ts) — the same list the
// vitest spec asserts, so the generated part and the test never drift.
for (const c of L.SKETCH_CASES) {
  if (c.raw) mkRaw(c.id, c.title, c.raw, { hostId: c.hostId, plane: c.plane });
  else mk(c.id, c.title, c.build, { hostId: c.hostId, plane: c.plane });
}

// Pre-solve every sketch that carries a constraint so its stored geometry
// already satisfies it (e.g. coincident points coincide, tangent circles
// touch, dimensioned edges hit their value). Constraint-free sketches are
// left untouched — solving them is a no-op anyway.
const solved = [];
for (const sid of Object.keys(sketches)) {
  const sk = sketches[sid];
  // Legacy-schema states (S12) have no `entities` — they upgrade on load, so
  // never feed them to the entity-model solver.
  if (!Array.isArray(sk.state.entities)) continue;
  if (!sk.state.constraints || sk.state.constraints.length === 0) continue;
  try {
    const r = await L.solveSketch(sk.state, {});
    if (r.status === 'ok') { sk.state = r.state; solved.push(sk.name.slice(0, 3)); }
    else failed.push(`${sk.name.slice(0, 3)}: solve ${r.status}`);
  } catch (e) { failed.push(`${sk.name.slice(0, 3)}: solve threw ${e.message}`); }
}

const doc = { sketches, nextSketchSeq: seq };
writeFileSync(OUT, JSON.stringify(doc));
console.log(`Generated ${ok.length} sketches → ${OUT}`);
console.log(`Pre-solved ${solved.length}: ${solved.join(', ')}`);
console.log('OK:', ok.join(', '));
// S08 is over-constrained BY DESIGN — its solve reporting 'inconsistent' is the
// expected outcome, not a failure. Anything else failing exits nonzero so CI /
// callers notice broken case builders instead of shipping a partial part.
const unexpected = failed.filter(f => !f.startsWith('S08:'));
if (failed.length) { console.log('\nFAILED (' + failed.length + '):'); for (const f of failed) console.log('  ' + f + (f.startsWith('S08:') ? '  (expected — conflicting dims)' : '')); }
if (unexpected.length) process.exit(1);
