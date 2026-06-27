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

// Bundle store + ops + types into one ESM module we can import.
const entry = `${FRONT}/_genentry.ts`;
const fs = await import('fs');
fs.writeFileSync(entry,
  `export * from './store';\nexport * from './sketchEditOps';\n`);
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
  outfile: '/tmp/_sketchlib.mjs', logLevel: 'error',
});
fs.unlinkSync(entry);
const L = await import(pathToFileURL('/tmp/_sketchlib.mjs').href);

const PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const sketches = {};
let seq = 1;
const ok = [], failed = [];

// mk(id, title, fn): fn(state, lib) -> final state. Per-case isolation.
function mk(id, title, fn) {
  try {
    let s = L.emptySketchState();
    s = fn(s);
    if (!s || !Array.isArray(s.entities)) throw new Error('builder returned no state');
    const sid = `s${String(seq).padStart(3, '0')}_${id}`;
    sketches[sid] = { id: sid, hostId: 'datum:xy_plane', name: `${id} — ${title}`, plane: PLANE, state: s, candidates: [], visible: false, createdAt: 1700000000000 + seq * 1000 };
    seq++; ok.push(id);
  } catch (e) { failed.push(`${id}: ${e.message}`); }
}
// helpers that thread state through the {state,...} / OpResult shape
const P = (s, x, y) => { const r = L.addPoint(s, x, y); return [r.state, r.id]; };
const opState = (r) => { if (r.error) throw new Error(r.error); return r.state; };

// ── Elements ────────────────────────────────────────────────────────────────
mk('E01', 'Point', s => { let p; [s, p] = P(s, 10, 10); return s; });
mk('E02', 'Line (2-pt)', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 10); return L.addLine(s, a, b).state; });
mk('E03', 'Construction line', s => { let a, b; [s, a] = P(s, 0, 20); [s, b] = P(s, 30, 20); s = L.addLine(s, a, b).state; const id = s.entities.at(-1).id; return L.setConstructionFlag(s, [id], true); });
mk('E04', 'Circle (center+radius)', s => L.addCircle(s, 0, 0, 12).state);
mk('E05', 'Circle (3-point)', s => L.addCircle3Points(s, -10, 0, 0, 10, 10, 0).state);
mk('E06', 'Arc (center+endpoints)', s => L.addArc(s, 0, 0, 10, 0, 0, 10, true).state);
mk('E07', 'Arc (3-point)', s => L.addArc3Points(s, -10, 0, 0, 10, 10, 0).state);
mk('E08', 'Ellipse', s => L.addEllipse(s, 0, 0, 15, 0, 8).state);
mk('E09', 'Elliptical arc', s => L.addEllipticalArc(s, 0, 0, 15, 0, 8, 0, Math.PI, true).state);
mk('E10', 'Spline (B-spline)', s => L.addSpline(s, [{ x: -20, y: 0 }, { x: -8, y: 14 }, { x: 8, y: -14 }, { x: 20, y: 0 }], 3).state);
mk('E11', 'Parabola', s => { let v, f, sp; [s, v] = P(s, 0, 0); [s, f] = P(s, 0, 5); [s, sp] = P(s, 10, 5); return L.addParabolaByPoints(s, v, f, sp).state; });
mk('E13', 'Text box', s => L.addTextBoxByCorners(s, 0, 0, 40, 12, 'TEST').state);
mk('E15', 'Equation curve', s => L.addEquationCurve(s, '10*Math.cos(t)', '10*Math.sin(2*t)', 0, 2 * Math.PI, 200).state);
mk('E18', 'Rectangle (corner)', s => L.addRectangleCorners(s, 0, 0, 30, 18).state);
mk('E19', 'Rectangle (center)', s => L.addRectangleCenter(s, 0, 0, 15, 9).state);
mk('E20', 'Rectangle (3-point)', s => L.addRectangle3PtCorner(s, 0, 0, 24, 6, 8).state);
mk('E22', 'Parallelogram', s => L.addParallelogram(s, 0, 0, 24, 0, 6, 12).state);
mk('E23', 'Polygon (hexagon)', s => L.addPolygon(s, 0, 0, 12, 0, 6).state);
mk('E24', 'Slot (straight)', s => L.addSlotStraight(s, -12, 0, 12, 0, 5).state);
mk('E26', 'Slot (arc 3-pt)', s => L.addSlotArc3Pt(s, -12, 0, 0, 8, 12, 0, 4).state);
mk('E27', 'Construction cascade', s => { s = L.addCircle(s, 0, 0, 10).state; const id = s.entities.find(e => e.kind === 'circle').id; return L.setConstructionFlag(s, [id], true); });

// ── Constraints (internal — no external refs) ────────────────────────────────
mk('C01', 'Coincident point/point', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 10, 0); return L.addConstraint(s, 'coincident', [a, b]).state; });
mk('C02', 'Coincident point-on-line', s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = s.entities.at(-1).id; [s, p] = P(s, 15, 6); return L.addConstraint(s, 'coincident', [p, ln]).state; });
mk('C03', 'Coincident point-on-circle', s => { s = L.addCircle(s, 0, 0, 12).state; const c = s.entities.find(e => e.kind === 'circle').id; let p; [s, p] = P(s, 12, 6); return L.addConstraint(s, 'coincident', [p, c]).state; });
mk('C04', 'Fixed', s => { let a; [s, a] = P(s, 7, 7); return L.addConstraint(s, 'fixed', [a]).state; });
mk('C05', 'Horizontal (line)', s => { let a, b; [s, a] = P(s, 0, 2); [s, b] = P(s, 30, 5); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'horizontal', [s.entities.at(-1).id]).state; });
mk('C06', 'Vertical (line)', s => { let a, b; [s, a] = P(s, 2, 0); [s, b] = P(s, 5, 30); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'vertical', [s.entities.at(-1).id]).state; });
mk('C07', 'Distance (p–p)', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); return L.addConstraint(s, 'distance', [a, b], 25, { x: 10, y: -6 }).state; });
mk('C08', 'Horizontal-distance', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 8); return L.addConstraint(s, 'horizontal-distance', [a, b], 20).state; });
mk('C09', 'Vertical-distance', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 8, 20); return L.addConstraint(s, 'vertical-distance', [a, b], 20).state; });
mk('C10', 'Perpendicular (line/line)', s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 0, 0); [s, d] = P(s, 3, 20); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'perpendicular', [l1, s.entities.at(-1).id]).state; });
mk('C12', 'Parallel (line/line)', s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 4); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 0, 10); [s, d] = P(s, 20, 12); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'parallel', [l1, s.entities.at(-1).id]).state; });
mk('C14', 'Tangent line/circle', s => { s = L.addCircle(s, 0, 0, 10).state; const c = s.entities.find(e => e.kind === 'circle').id; let a, b; [s, a] = P(s, -15, 10); [s, b] = P(s, 15, 11); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'tangent', [s.entities.at(-1).id, c]).state; });
mk('C16', 'Tangent circle/circle (ext)', s => { s = L.addCircle(s, -8, 0, 6).state; const c1 = s.entities.at(-1).id; s = L.addCircle(s, 8, 0, 6).state; return L.addConstraint(s, 'tangent', [c1, s.entities.at(-1).id]).state; });
mk('C19', 'Equal length (line/line)', s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 18, 0); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 0, 8); [s, d] = P(s, 24, 8); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'equal', [l1, s.entities.at(-1).id]).state; });
mk('C20', 'Equal radius (circle/circle)', s => { s = L.addCircle(s, -10, 0, 6).state; const c1 = s.entities.at(-1).id; s = L.addCircle(s, 10, 0, 9).state; return L.addConstraint(s, 'equal', [c1, s.entities.at(-1).id]).state; });
mk('C21', 'Midpoint', s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = s.entities.at(-1).id; [s, p] = P(s, 14, 0); return L.addConstraint(s, 'midpoint', [p, ln]).state; });
mk('C22', 'Symmetric (2 pts about line)', s => { let a, b, c, d; [s, a] = P(s, 0, -15); [s, b] = P(s, 0, 15); s = L.addLine(s, a, b).state; s = L.setConstructionFlag(s, [s.entities.at(-1).id], true); const axis = s.entities.at(-1).id; [s, c] = P(s, -8, 5); [s, d] = P(s, 8, 4); return L.addConstraint(s, 'symmetric', [c, d, axis]).state; });
mk('C23', 'Concentric', s => { s = L.addCircle(s, 0, 0, 6).state; const c1 = s.entities.at(-1).id; s = L.addCircle(s, 1, 1, 12).state; return L.addConstraint(s, 'concentric', [c1, s.entities.at(-1).id]).state; });
mk('C24', 'Coradial', s => { s = L.addCircle(s, 0, 0, 8).state; const c1 = s.entities.at(-1).id; s = L.addCircle(s, 3, 0, 8.5).state; return L.addConstraint(s, 'coradial', [c1, s.entities.at(-1).id]).state; });
mk('C26', 'Collinear', s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 10, 1); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 16, 2); [s, d] = P(s, 26, 1); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'collinear', [l1, s.entities.at(-1).id]).state; });
mk('C27', 'Radius dim', s => { s = L.addCircle(s, 0, 0, 11).state; return L.addConstraint(s, 'radius', [s.entities.find(e => e.kind === 'circle').id], 11, { x: 8, y: 8 }).state; });
mk('C28', 'Diameter dim', s => { s = L.addCircle(s, 0, 0, 9).state; return L.addConstraint(s, 'diameter', [s.entities.find(e => e.kind === 'circle').id], 18, { x: 8, y: -8 }).state; });
mk('C29', 'Angle dim (line/line)', s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 0, 0); [s, d] = P(s, 16, 12); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'angle', [l1, s.entities.at(-1).id], Math.PI / 4, { x: 8, y: 4 }, false, undefined, [1, 1]).state; });
mk('C30', 'Point-line-distance', s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = s.entities.at(-1).id; [s, p] = P(s, 15, 9); return L.addConstraint(s, 'point-line-distance', [p, ln], 9, { x: 15, y: 5 }).state; });
mk('C32', 'Arc-length dim', s => { s = L.addArc(s, 0, 0, 10, 0, 0, 10, true).state; return L.addConstraint(s, 'arc-length', [s.entities.find(e => e.kind === 'arc').id], 15.7).state; });
mk('C33', 'Chord-distance dim', s => { s = L.addArc(s, 0, 0, 10, 0, 0, 10, true).state; return L.addConstraint(s, 'chord-distance', [s.entities.find(e => e.kind === 'arc').id], 14.1).state; });
mk('C34', 'Radial-distance dim', s => { s = L.addCircle(s, 0, 0, 5).state; const c1 = s.entities.at(-1).id; s = L.addCircle(s, 0, 0, 12).state; const c2 = s.entities.at(-1).id; s = L.addConstraint(s, 'concentric', [c1, c2]).state; return L.addConstraint(s, 'radial-distance', [c1, c2], 7).state; });
mk('C41', 'Driven / reference dim', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); return L.addConstraint(s, 'distance', [a, b], 20, { x: 10, y: -6 }, true).state; });

// ── Operations ───────────────────────────────────────────────────────────────
mk('O01', 'Trim line', s => { let a, b; [s, a] = P(s, -20, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const target = s.entities.at(-1).id; let c, d, e, f; [s, c] = P(s, -8, -10); [s, d] = P(s, -8, 10); s = L.addLine(s, c, d).state; [s, e] = P(s, 8, -10); [s, f] = P(s, 8, 10); s = L.addLine(s, e, f).state; return opState(L.trimAt(s, target, { x: 0, y: 0 })); });
mk('O06', 'Mirror about line', s => { let a, b; [s, a] = P(s, 0, -15); [s, b] = P(s, 0, 15); s = L.addLine(s, a, b).state; s = L.setConstructionFlag(s, [s.entities.at(-1).id], true); const axis = s.entities.at(-1).id; let c, d; [s, c] = P(s, 6, 0); [s, d] = P(s, 16, 8); s = L.addLine(s, c, d).state; const ln = s.entities.at(-1).id; return opState(L.mirrorEntities(s, [ln], axis)); });
mk('O07', 'Offset line', s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; return opState(L.offsetCurve(s, s.entities.at(-1).id, 5, { x: 15, y: 5 })); });
mk('O10', 'Fillet line/line', s => { let a, b, c; [s, a] = P(s, 0, 20); [s, b] = P(s, 0, 0); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 20, 0); s = L.addLine(s, b, c).state; const l2 = s.entities.at(-1).id; return opState(L.filletLines(s, l1, l2, 4)); });
mk('O13', 'Chamfer (equal)', s => { let a, b, c; [s, a] = P(s, 0, 20); [s, b] = P(s, 0, 0); s = L.addLine(s, a, b).state; const l1 = s.entities.at(-1).id; [s, c] = P(s, 20, 0); s = L.addLine(s, b, c).state; const l2 = s.entities.at(-1).id; return opState(L.chamferLines(s, l1, l2, 4)); });
mk('O16', 'Move entities', s => { s = L.addCircle(s, 0, 0, 8).state; const c = s.entities.find(e => e.kind === 'circle').id; return L.moveEntities(s, [c], 15, 5).state ? L.moveEntities(s, [c], 15, 5).state : s; });
mk('O20', 'Linear pattern', s => { s = L.addCircle(s, 0, 0, 3).state; const c = s.entities.find(e => e.kind === 'circle').id; return opState(L.linearPatternEntities(s, [c], 10, 0, 4)); });
mk('O21', 'Circular pattern', s => { s = L.addCircle(s, 15, 0, 3).state; const c = s.entities.find(e => e.kind === 'circle').id; return opState(L.circularPatternEntities(s, [c], { x: 0, y: 0 }, 2 * Math.PI, 6)); });

// ── Sketch-level ──────────────────────────────────────────────────────────────
mk('S01', 'Closed profile loop', s => L.addRectangleCorners(s, 0, 0, 30, 18).state);
mk('S02', 'Nested loops (hole)', s => { s = L.addRectangleCorners(s, -20, -12, 20, 12).state; return L.addCircle(s, 0, 0, 6).state; });
mk('S05', 'Single-circle profile', s => L.addCircle(s, 0, 0, 12).state);
mk('S09', 'Origin-anchored dim', s => { let a; [s, a] = P(s, 18, 0); return L.addConstraint(s, 'distance', ['origin', a], 18, { x: 9, y: -6 }).state; });

const doc = { sketches, nextSketchSeq: seq };
writeFileSync(OUT, JSON.stringify(doc));
console.log(`Generated ${ok.length} sketches → ${OUT}`);
console.log('OK:', ok.join(', '));
if (failed.length) { console.log('\nFAILED (' + failed.length + '):'); for (const f of failed) console.log('  ' + f); }
