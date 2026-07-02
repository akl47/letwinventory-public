#!/usr/bin/env node
// Generate the 3D-feature test cases from
// docs/cad-system/cad-modeler/3d-feature-test-cases.md. Each case is a
// SELF-CONTAINED part: its own featureTree + sketchDoc, built at the origin.
// (Provisioned into one Part + CAD model each by provision-3d-test-parts.mjs.)
//
// Geometry refs (fillet/chamfer edges, hole placements, shell faces, datum
// planes) are stored GEOMETRICALLY — computed from each case's known base-box
// dimensions — so they resolve without interactive picking.
//
// Usage: node scripts/gen-3d-test-part.mjs   # writes /tmp/3d-test-cases.json (array)
import { writeFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'frontend') + '/');
const { build } = require('esbuild');
const FRONT = path.join(REPO, 'frontend/src/app/cad/lib');
const OUT = '/tmp/3d-test-cases.json';

const fs = await import('fs');
const entry = `${FRONT}/_gen3dentry.ts`;
fs.writeFileSync(entry, `export * from './store';\n`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: '/tmp/_sketchlib3d.mjs', logLevel: 'error' });
fs.unlinkSync(entry);
const L = await import(pathToFileURL('/tmp/_sketchlib3d.mjs').href);

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

// Per-case builder context — fresh featureTree + sketchDoc, everything at origin.
function makeCtx() {
  const sketches = {};
  const features = [{ id: 'f1', type: 'origin' }];
  let skSeq = 1, ftSeq = 2;
  const ftId = () => `f${ftSeq++}`;
  const sketch = (state) => {
    const id = `sk${String(skSeq++).padStart(3, '0')}`;
    sketches[id] = { id, hostId: 'datum:xy_plane', name: id, plane: XY_PLANE, state, candidates: [], visible: false, createdAt: 1700000000000 + skSeq * 1000 };
    return id;
  };
  const push = (f) => { features.push(f); return f; };
  const rect = (x0, y0, w, h) => sketch(L.addRectangleCorners(L.emptySketchState(), x0, y0, x0 + w, y0 + h).state);
  // Rectangle returning the line ids too (for revolve axis picks).
  const rectRaw = (x0, y0, w, h) => { const r = L.addRectangleCorners(L.emptySketchState(), x0, y0, x0 + w, y0 + h); return { sk: sketch(r.state), ids: r.ids }; };
  const done = () => ({ featureTree: { features, nextFeatureSeq: ftSeq }, sketchDoc: { sketches, nextSketchSeq: skSeq } });
  return { L, sketch, push, rect, rectRaw, ftId, done };
}

// A base 20×20×12 box at the origin; returns its extrude feature id.
function box(c, name = 'base') {
  return c.push({ id: c.ftId(), type: 'extrude', name, sketchId: c.rect(0, 0, 20, 20), distance: 12, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false }).id;
}

// ── Case registry ───────────────────────────────────────────────────────────
const CASES = [];
const C = (id, title, build) => CASES.push({ id, title, build });

C('B01', 'Extrude blind', c => {
  c.push({ id: c.ftId(), type: 'extrude', name: 'B01 — Extrude blind', sketchId: c.rect(0, 0, 20, 20), distance: 12, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false });
});

C('B02', 'Extrude mid-plane', c => {
  c.push({ id: c.ftId(), type: 'extrude', name: 'B02 — Extrude mid-plane', sketchId: c.rect(0, 0, 20, 20), distance: 12, endCondition: { kind: 'midPlane' }, regionIndices: [0], merge: false });
});

C('B14', 'Revolve 360', c => {
  const r = c.rectRaw(0, 0, 8, 15);
  c.push({ id: c.ftId(), type: 'revolve', name: 'B14 — Revolve 360', sketchId: r.sk, axisLineId: r.ids[3], angle: 360, regionIndices: [0], merge: false });
});

C('U01', 'Cut-extrude through', c => {
  box(c, 'U01 base');
  c.push({ id: c.ftId(), type: 'cutExtrude', name: 'U01 — Cut-extrude through', sketchId: c.rect(5, 5, 10, 10), distance: 12, endCondition: { kind: 'throughAll' }, regionIndices: [0] });
});

C('U07', 'Hole drill', c => {
  box(c, 'U07 base');
  c.push({ id: c.ftId(), type: 'hole', name: 'U07 — Hole drill', holeType: 'drill', standard: 'iso', size: 'M6', endCondition: { kind: 'throughAll' }, placements: [{ faceId: '', position: [10, 10, 12], faceCentroid: [10, 10, 12], faceNormal: [0, 0, 1] }] });
});

C('U09', 'Hole counterbore', c => {
  box(c, 'U09 base');
  c.push({ id: c.ftId(), type: 'hole', name: 'U09 — Hole counterbore', holeType: 'counterbore', standard: 'iso', size: 'M6', endCondition: { kind: 'throughAll' }, placements: [{ faceId: '', position: [10, 10, 12], faceCentroid: [10, 10, 12], faceNormal: [0, 0, 1] }] });
});

C('U10', 'Hole countersink', c => {
  box(c, 'U10 base');
  c.push({ id: c.ftId(), type: 'hole', name: 'U10 — Hole countersink', holeType: 'countersink', standard: 'iso', size: 'M6', endCondition: { kind: 'throughAll' }, placements: [{ faceId: '', position: [10, 10, 12], faceCentroid: [10, 10, 12], faceNormal: [0, 0, 1] }] });
});

C('D01', 'Fillet edge', c => {
  box(c, 'D01 base');
  c.push({ id: c.ftId(), type: 'fillet', name: 'D01 — Fillet edge', radius: 4, edges: [{ start: [0, 0, 0], end: [0, 0, 12] }] });
});

C('D06', 'Chamfer equal', c => {
  box(c, 'D06 base');
  c.push({ id: c.ftId(), type: 'chamfer', name: 'D06 — Chamfer equal', distance: 3, mode: 'equal', edges: [{ start: [0, 0, 0], end: [0, 0, 12] }] });
});

C('D10', 'Shell inward', c => {
  box(c, 'D10 base');
  c.push({ id: c.ftId(), type: 'shell', name: 'D10 — Shell inward', thickness: 2, direction: 'inward', faces: [{ faceId: '', fallbackPlane: { origin: [10, 10, 12], normal: [0, 0, 1] } }] });
});

C('R01', 'Datum plane offset', c => {
  c.push({ id: c.ftId(), type: 'datumPlane', name: 'R01 — Datum plane offset', method: { kind: 'offset', planeRef: { kind: 'datum', datumId: 'xy_plane' }, distance: 10 } });
});

C('M01', 'Combine add', c => {
  const a = c.push({ id: c.ftId(), type: 'extrude', name: 'M01 body A', sketchId: c.rect(0, 0, 14, 14), distance: 12, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false }).id;
  const b = c.push({ id: c.ftId(), type: 'extrude', name: 'M01 body B', sketchId: c.rect(6, 6, 14, 14), distance: 12, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false }).id;
  c.push({ id: c.ftId(), type: 'combine', name: 'M01 — Combine add', operation: 'add', targetBodyId: a, toolBodyIds: [b] });
});

C('M04', 'Multi-body', c => {
  c.push({ id: c.ftId(), type: 'extrude', name: 'M04 — Multi-body A', sketchId: c.rect(0, 0, 10, 10), distance: 10, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false });
  c.push({ id: c.ftId(), type: 'extrude', name: 'M04 — Multi-body B', sketchId: c.rect(15, 0, 10, 10), distance: 10, endCondition: { kind: 'blind' }, regionIndices: [0], merge: false });
});

// ── emit ────────────────────────────────────────────────────────────────────
const out = [];
for (const { id, title, build } of CASES) {
  const c = makeCtx();
  build(c);
  out.push({ id, title, ...c.done() });
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${out.length} self-contained cases → ${OUT}`);
console.log('Cases:', out.map(c => c.id).join(', '));
