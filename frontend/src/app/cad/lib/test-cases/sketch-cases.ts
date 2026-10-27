// Single source of truth for the sketch test cases from
// docs/cad-system/cad-modeler/sketch-test-cases.md.
//
// Consumed by BOTH:
//   - scripts/gen-sketch-test-part.mjs  (builds the manual-verification part;
//     esbuild bundles this module alongside the store)
//   - sketch-cases.spec.ts              (asserts every case builds + solves on
//     every frontend test run / CI push)
//
// Each `build` reads identically to the old inline generator cases; they share
// the same `L` (store + sketch-edit ops) so behaviour can't drift between the
// generated part and the test.

import * as store from '../store';
import * as ops from '../sketchEditOps';
import type { SketchState } from '../types';

const L = { ...store, ...ops };
type S = SketchState;

const P = (s: S, x: number, y: number): [S, string] => {
  const r = L.addPoint(s, x, y);
  return [r.state, r.id];
};
const opState = (r: { error?: string; state: S }): S => {
  if (r.error) throw new Error(r.error);
  return r.state;
};

export type PlaneFrame = { origin: number[]; xAxis: number[]; yAxis: number[]; normal: number[] };
const PLANE_XZ: PlaneFrame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] };

export interface SketchCase {
  id: string;
  title: string;
  /** Entity-model builder — returns the finished sketch state. */
  build?: (s: S) => S;
  /** Legacy `{points,lines,constraints}` blob that must upgrade on load (S12). */
  raw?: unknown;
  hostId?: string;
  plane?: PlaneFrame;
  /** Determinacy hint for the spec (S06 pinned, S07 free). Absent = build-only. */
  expect?: { fullyConstrained?: boolean };
}

const lastId = (s: S) => s.entities[s.entities.length - 1].id;
const findKind = (s: S, kind: string) => s.entities.find(e => e.kind === kind)!.id;

export const SKETCH_CASES: SketchCase[] = [
  // ── Elements ──────────────────────────────────────────────────────────────
  { id: 'E01', title: 'Point', build: s => { let p; [s, p] = P(s, 10, 10); void p; return s; } },
  { id: 'E02', title: 'Line (2-pt)', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 10); return L.addLine(s, a, b).state; } },
  { id: 'E03', title: 'Construction line', build: s => { let a, b; [s, a] = P(s, 0, 20); [s, b] = P(s, 30, 20); s = L.addLine(s, a, b).state; return L.setConstructionFlag(s, [lastId(s)], true); } },
  { id: 'E04', title: 'Circle (center+radius)', build: s => L.addCircle(s, 0, 0, 12).state },
  { id: 'E05', title: 'Circle (3-point)', build: s => L.addCircle3Points(s, -10, 0, 0, 10, 10, 0).state },
  { id: 'E06', title: 'Arc (center+endpoints)', build: s => L.addArc(s, 0, 0, 10, 0, 0, 10, true).state },
  { id: 'E07', title: 'Arc (3-point)', build: s => L.addArc3Points(s, -10, 0, 0, 10, 10, 0).state },
  { id: 'E08', title: 'Ellipse', build: s => L.addEllipse(s, 0, 0, 15, 0, 8).state },
  { id: 'E09', title: 'Elliptical arc', build: s => L.addEllipticalArc(s, 0, 0, 15, 0, 8, 0, Math.PI, true).state },
  { id: 'E10', title: 'Spline (B-spline)', build: s => L.addSpline(s, [{ x: -20, y: 0 }, { x: -8, y: 14 }, { x: 8, y: -14 }, { x: 20, y: 0 }], 3).state },
  { id: 'E11', title: 'Parabola', build: s => { let v, f, sp; [s, v] = P(s, 0, 0); [s, f] = P(s, 0, 5); [s, sp] = P(s, 10, 5); return L.addParabolaByPoints(s, v, f, sp).state; } },
  { id: 'E13', title: 'Text box', build: s => L.addTextBoxByCorners(s, 0, 0, 40, 12, 'TEST').state },
  { id: 'E15', title: 'Equation curve', build: s => L.addEquationCurve(s, '10*Math.cos(t)', '10*Math.sin(2*t)', 0, 2 * Math.PI, 200).state },
  { id: 'E18', title: 'Rectangle (corner)', build: s => L.addRectangleCorners(s, 0, 0, 30, 18).state },
  { id: 'E19', title: 'Rectangle (center)', build: s => L.addRectangleCenter(s, 0, 0, 15, 9).state },
  { id: 'E20', title: 'Rectangle (3-point)', build: s => L.addRectangle3PtCorner(s, 0, 0, 24, 0, 0, 12).state },
  { id: 'E22', title: 'Parallelogram', build: s => L.addParallelogram(s, 0, 0, 24, 0, 6, 12).state },
  { id: 'E23', title: 'Polygon (hexagon)', build: s => L.addPolygon(s, 0, 0, 12, 0, 6).state },
  { id: 'E24', title: 'Slot (straight)', build: s => L.addSlotStraight(s, -12, 0, 12, 0, 5).state },
  { id: 'E26', title: 'Slot (arc 3-pt)', build: s => L.addSlotArc3Pt(s, -12, 0, 0, 8, 12, 0, 4).state },
  { id: 'E27', title: 'Construction cascade', build: s => { s = L.addArc(s, 0, 0, 12, 0, 0, 12, true).state; return L.setConstructionFlag(s, [findKind(s, 'arc')], true); } },

  // ── Constraints ─────────────────────────────────────────────────────────────
  { id: 'C01', title: 'Coincident point/point', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 10, 0); return L.addConstraint(s, 'coincident', [a, b]).state; } },
  { id: 'C02', title: 'Coincident point-on-line', build: s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = lastId(s); [s, p] = P(s, 15, 6); return L.addConstraint(s, 'coincident', [p, ln]).state; } },
  { id: 'C03', title: 'Coincident point-on-circle', build: s => { s = L.addCircle(s, 0, 0, 12).state; const c = findKind(s, 'circle'); let p; [s, p] = P(s, 12, 6); return L.addConstraint(s, 'coincident', [p, c]).state; } },
  { id: 'C04', title: 'Fixed', build: s => { let a; [s, a] = P(s, 7, 7); return L.addConstraint(s, 'fixed', [a]).state; } },
  { id: 'C05', title: 'Horizontal (line)', build: s => { let a, b; [s, a] = P(s, 0, 2); [s, b] = P(s, 30, 5); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'horizontal', [lastId(s)]).state; } },
  { id: 'C06', title: 'Vertical (line)', build: s => { let a, b; [s, a] = P(s, 2, 0); [s, b] = P(s, 5, 30); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'vertical', [lastId(s)]).state; } },
  { id: 'C07', title: 'Distance (p–p)', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); return L.addConstraint(s, 'distance', [a, b], 25, { x: 10, y: -6 }).state; } },
  { id: 'C08', title: 'Horizontal-distance', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 8); return L.addConstraint(s, 'horizontal-distance', [a, b], 20).state; } },
  { id: 'C09', title: 'Vertical-distance', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 8, 20); return L.addConstraint(s, 'vertical-distance', [a, b], 20).state; } },
  { id: 'C10', title: 'Perpendicular (line/line)', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 0, 0); [s, d] = P(s, 3, 20); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'perpendicular', [l1, lastId(s)]).state; } },
  { id: 'C12', title: 'Parallel (line/line)', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 4); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 0, 10); [s, d] = P(s, 20, 12); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'parallel', [l1, lastId(s)]).state; } },
  { id: 'C14', title: 'Tangent line/circle', build: s => { s = L.addCircle(s, 0, 0, 10).state; const c = findKind(s, 'circle'); let a, b; [s, a] = P(s, -15, 10); [s, b] = P(s, 15, 11); s = L.addLine(s, a, b).state; return L.addConstraint(s, 'tangent', [lastId(s), c]).state; } },
  { id: 'C16', title: 'Tangent circle/circle (ext)', build: s => { s = L.addCircle(s, -8, 0, 6).state; const c1 = lastId(s); s = L.addCircle(s, 8, 0, 6).state; return L.addConstraint(s, 'tangent', [c1, lastId(s)]).state; } },
  { id: 'C19', title: 'Equal length (line/line)', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 18, 0); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 0, 8); [s, d] = P(s, 24, 8); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'equal', [l1, lastId(s)]).state; } },
  { id: 'C20', title: 'Equal radius (circle/circle)', build: s => { s = L.addCircle(s, -10, 0, 6).state; const c1 = lastId(s); s = L.addCircle(s, 10, 0, 9).state; return L.addConstraint(s, 'equal', [c1, lastId(s)]).state; } },
  { id: 'C21', title: 'Midpoint', build: s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = lastId(s); [s, p] = P(s, 14, 0); return L.addConstraint(s, 'midpoint', [p, ln]).state; } },
  { id: 'C22', title: 'Symmetric (2 pts about line)', build: s => { let a, b, c, d; [s, a] = P(s, 0, -15); [s, b] = P(s, 0, 15); s = L.addLine(s, a, b).state; s = L.setConstructionFlag(s, [lastId(s)], true); const axis = lastId(s); [s, c] = P(s, -8, 5); [s, d] = P(s, 8, 4); return L.addConstraint(s, 'symmetric', [c, d, axis]).state; } },
  { id: 'C23', title: 'Concentric', build: s => { s = L.addCircle(s, 0, 0, 6).state; const c1 = lastId(s); s = L.addCircle(s, 1, 1, 12).state; return L.addConstraint(s, 'concentric', [c1, lastId(s)]).state; } },
  { id: 'C24', title: 'Coradial', build: s => { s = L.addCircle(s, 0, 0, 8).state; const c1 = lastId(s); s = L.addCircle(s, 3, 0, 8.5).state; return L.addConstraint(s, 'coradial', [c1, lastId(s)]).state; } },
  { id: 'C26', title: 'Collinear', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 10, 1); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 16, 2); [s, d] = P(s, 26, 1); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'collinear', [l1, lastId(s)]).state; } },
  { id: 'C27', title: 'Radius dim', build: s => { s = L.addCircle(s, 0, 0, 11).state; return L.addConstraint(s, 'radius', [findKind(s, 'circle')], 11, { x: 8, y: 8 }).state; } },
  { id: 'C28', title: 'Diameter dim', build: s => { s = L.addCircle(s, 0, 0, 9).state; return L.addConstraint(s, 'diameter', [findKind(s, 'circle')], 18, { x: 8, y: -8 }).state; } },
  { id: 'C29', title: 'Angle dim (line/line)', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 0, 0); [s, d] = P(s, 16, 12); s = L.addLine(s, c, d).state; return L.addConstraint(s, 'angle', [l1, lastId(s)], Math.PI / 4, { x: 8, y: 4 }, false, undefined, [1, 1]).state; } },
  { id: 'C30', title: 'Point-line-distance', build: s => { let a, b, p; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; const ln = lastId(s); [s, p] = P(s, 15, 9); return L.addConstraint(s, 'point-line-distance', [p, ln], 9, { x: 15, y: 5 }).state; } },
  { id: 'C32', title: 'Arc-length dim', build: s => { s = L.addArc(s, 0, 0, 10, 0, 0, 10, true).state; return L.addConstraint(s, 'arc-length', [findKind(s, 'arc')], 15.7).state; } },
  { id: 'C33', title: 'Chord-distance dim', build: s => { s = L.addArc(s, 0, 0, 10, 0, 0, 10, true).state; return L.addConstraint(s, 'chord-distance', [findKind(s, 'arc')], 14.1).state; } },
  { id: 'C34', title: 'Radial-distance dim', build: s => { s = L.addCircle(s, 0, 0, 5).state; const c1 = lastId(s); s = L.addCircle(s, 0, 0, 12).state; const c2 = lastId(s); s = L.addConstraint(s, 'concentric', [c1, c2]).state; return L.addConstraint(s, 'radial-distance', [c1, c2], 7).state; } },
  { id: 'C41', title: 'Driven / reference dim', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); return L.addConstraint(s, 'distance', [a, b], 20, { x: 10, y: -6 }, true).state; } },

  // ── Operations ────────────────────────────────────────────────────────────
  { id: 'O01', title: 'Trim line', build: s => { let a, b; [s, a] = P(s, -20, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; const target = lastId(s); let c, d, e, f; [s, c] = P(s, -8, -10); [s, d] = P(s, -8, 10); s = L.addLine(s, c, d).state; [s, e] = P(s, 8, -10); [s, f] = P(s, 8, 10); s = L.addLine(s, e, f).state; return opState(L.trimAt(s, target, { x: 0, y: 0 })); } },
  { id: 'O06', title: 'Mirror about line', build: s => { let a, b; [s, a] = P(s, 0, -15); [s, b] = P(s, 0, 15); s = L.addLine(s, a, b).state; s = L.setConstructionFlag(s, [lastId(s)], true); const axis = lastId(s); let c, d; [s, c] = P(s, 6, 0); [s, d] = P(s, 16, 8); s = L.addLine(s, c, d).state; const ln = lastId(s); return opState(L.mirrorEntities(s, [ln], axis)); } },
  { id: 'O07', title: 'Offset line', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 30, 0); s = L.addLine(s, a, b).state; return opState(L.offsetCurve(s, lastId(s), 5, { x: 15, y: 5 })); } },
  { id: 'O10', title: 'Fillet line/line', build: s => { let a, b, c; [s, a] = P(s, 0, 20); [s, b] = P(s, 0, 0); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 20, 0); s = L.addLine(s, b, c).state; const l2 = lastId(s); return opState(L.filletLines(s, l1, l2, 4)); } },
  { id: 'O13', title: 'Chamfer (equal)', build: s => { let a, b, c; [s, a] = P(s, 0, 20); [s, b] = P(s, 0, 0); s = L.addLine(s, a, b).state; const l1 = lastId(s); [s, c] = P(s, 20, 0); s = L.addLine(s, b, c).state; const l2 = lastId(s); return opState(L.chamferLines(s, l1, l2, 4)); } },
  { id: 'O16', title: 'Move entities', build: s => { s = L.addCircle(s, 0, 0, 8).state; const c = findKind(s, 'circle'); return opState(L.moveEntities(s, [c], 15, 5)); } },
  { id: 'O20', title: 'Linear pattern', build: s => { s = L.addCircle(s, 0, 0, 3).state; const c = findKind(s, 'circle'); return opState(L.linearPatternEntities(s, [c], 10, 0, 4)); } },
  { id: 'O21', title: 'Circular pattern', build: s => { s = L.addCircle(s, 15, 0, 3).state; const c = findKind(s, 'circle'); return opState(L.circularPatternEntities(s, [c], { x: 0, y: 0 }, 2 * Math.PI, 6)); } },

  // ── Sketch-level ────────────────────────────────────────────────────────────
  { id: 'S01', title: 'Closed profile loop', build: s => L.addRectangleCorners(s, 0, 0, 30, 18).state },
  { id: 'S02', title: 'Nested loops (hole)', build: s => { s = L.addRectangleCorners(s, -20, -12, 20, 12).state; return L.addCircle(s, 0, 0, 6).state; } },
  { id: 'S03', title: 'Self-intersection (figure-eight)', build: s => { let a, b, c, d; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 20); [s, c] = P(s, 20, 0); [s, d] = P(s, 0, 20); s = L.addLine(s, a, b).state; s = L.addLine(s, b, c).state; s = L.addLine(s, c, d).state; return L.addLine(s, d, a).state; } },
  { id: 'S04', title: 'Construction excluded from profile', build: s => { s = L.addRectangleCorners(s, 0, 0, 30, 16).state; let a, b; [s, a] = P(s, 0, 8); [s, b] = P(s, 30, 8); s = L.addLine(s, a, b).state; return L.setConstructionFlag(s, [lastId(s)], true); } },
  { id: 'S05', title: 'Single-circle profile', build: s => L.addCircle(s, 0, 0, 12).state },
  { id: 'S06', title: 'Fully constrained (DOF 0)', expect: { fullyConstrained: true }, build: s => { const r = L.addRectangleCorners(s, 0, 0, 30, 18); s = r.state; const [bl, br, tr] = r.corners.map(c => c.id); s = L.addConstraint(s, 'coincident', [bl, 'origin']).state; s = L.addConstraint(s, 'distance', [bl, br], 30, { x: 15, y: -6 }).state; return L.addConstraint(s, 'distance', [br, tr], 18, { x: 36, y: 9 }).state; } },
  { id: 'S07', title: 'Under-constrained', expect: { fullyConstrained: false }, build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 22, 6); return L.addLine(s, a, b).state; } },
  // Conflicting dims — its "inconsistent" outcome needs the solver, verified in
  // solver.spec.ts / the kernel; here we just assert it builds.
  { id: 'S08', title: 'Over-constrained (conflicting)', build: s => { let a, b; [s, a] = P(s, 0, 0); [s, b] = P(s, 20, 0); s = L.addLine(s, a, b).state; s = L.addConstraint(s, 'distance', [a, b], 20, { x: 10, y: -6 }).state; return L.addConstraint(s, 'distance', [a, b], 30, { x: 10, y: 6 }).state; } },
  { id: 'S09', title: 'Origin-anchored dim', build: s => { let a; [s, a] = P(s, 18, 0); return L.addConstraint(s, 'distance', ['origin', a], 18, { x: 9, y: -6 }).state; } },
  { id: 'S10', title: 'Datum-plane placement (XZ)', hostId: 'datum:xz_plane', plane: PLANE_XZ, build: s => L.addRectangleCorners(s, 0, 0, 24, 14).state },
  { id: 'S11', title: 'Dimension off datum plane (Δy to XZ)', build: s => { let a; [s, a] = P(s, 12, 15); return L.addConstraint(s, 'vertical-distance', ['origin', a], 15).state; } },
  {
    id: 'S12', title: 'Legacy-doc migration',
    raw: {
      points: [{ id: 'lp1', x: 0, y: 0 }, { id: 'lp2', x: 24, y: 0 }, { id: 'lp3', x: 24, y: 14 }, { id: 'lp4', x: 0, y: 14 }],
      lines: [{ id: 'll1', startId: 'lp1', endId: 'lp2' }, { id: 'll2', startId: 'lp2', endId: 'lp3' }, { id: 'll3', startId: 'lp3', endId: 'lp4' }, { id: 'll4', startId: 'lp4', endId: 'lp1' }],
      constraints: [{ id: 'lc1', type: 'point-on-line', targets: ['lp1', 'll1'] }],
    },
  },
];
