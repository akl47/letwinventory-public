// REQ 883 — closed splines and ellipses become extrudable profiles as chains
// of cubic Bézier edges (same kernel path as text glyphs: Edge::bezier).
//
// ── DRIFT GUARD ──
// This spec and `backend/tests/__tests__/design/cad-profile-curves.test.js`
// run the SAME fixtures and pin the SAME numbers, so the frontend extrude
// preview and the server regen stay identical. If you change the conversion
// math in curveBeziers.ts, change cadCurveBeziers.js too and re-pin BOTH.

import { describe, it, expect } from 'vitest';
import { extractRegions } from './profile';
import type { BezierProfileEdge, ProfileLoop } from './profile';
import { bezierSegsFromSpline, bezierSegsFromEllipse, KAPPA } from './curveBeziers';
import type { SketchState, SketchEntity } from './types';

// ── Fixtures (KEEP IN SYNC with cad-profile-curves.test.js) ────────────────

// Closed cubic spline: 6 distinct points, closed by repeating the first
// control-point id → 7 control points → 4 cubic Bézier spans.
const SPLINE_POINTS: Array<[string, number, number]> = [
  ['sp1', 110, 0], ['sp2', 110, 8], ['sp3', 100, 12],
  ['sp4', 90, 8], ['sp5', 90, -8], ['sp6', 100, -12],
];
const CLOSED_SPLINE_IDS = ['sp1', 'sp2', 'sp3', 'sp4', 'sp5', 'sp6', 'sp1'];

function closedSplineState(): SketchState {
  const entities: SketchEntity[] = [
    ...SPLINE_POINTS.map(([id, x, y]): SketchEntity => ({ kind: 'point', id, x, y })),
    { kind: 'spline', id: 'spl1', controlPointIds: [...CLOSED_SPLINE_IDS], degree: 3 },
  ];
  return { entities, constraints: [] };
}

function openSplineState(): SketchState {
  const entities: SketchEntity[] = [
    ...SPLINE_POINTS.map(([id, x, y]): SketchEntity => ({ kind: 'point', id, x, y })),
    { kind: 'spline', id: 'spl1', controlPointIds: SPLINE_POINTS.map(([id]) => id), degree: 3 },
  ];
  return { entities, constraints: [] };
}

// Rotated ellipse: center (2,3), major axis a=8 at 30°, minor radius b=4.
const ELLIPSE_A = 8;
const ELLIPSE_B = 4;
const ELLIPSE_CX = 2, ELLIPSE_CY = 3;
const ELLIPSE_MX = ELLIPSE_CX + ELLIPSE_A * Math.cos(Math.PI / 6);
const ELLIPSE_MY = ELLIPSE_CY + ELLIPSE_A * Math.sin(Math.PI / 6);

function ellipseState(): SketchState {
  const entities: SketchEntity[] = [
    { kind: 'point', id: 'ec', x: ELLIPSE_CX, y: ELLIPSE_CY },
    { kind: 'point', id: 'em', x: ELLIPSE_MX, y: ELLIPSE_MY },
    { kind: 'ellipse', id: 'el1', centerId: 'ec', majorAxisEndId: 'em', minorRadius: ELLIPSE_B },
  ];
  return { entities, constraints: [] };
}

// Rectangle (arrangement-walker profile) + the closed spline, disjoint.
function rectAndSplineState(): SketchState {
  const entities: SketchEntity[] = [
    { kind: 'point', id: 'r1', x: 0, y: 0 },
    { kind: 'point', id: 'r2', x: 40, y: 0 },
    { kind: 'point', id: 'r3', x: 40, y: 30 },
    { kind: 'point', id: 'r4', x: 0, y: 30 },
    { kind: 'line', id: 'l1', startId: 'r1', endId: 'r2' },
    { kind: 'line', id: 'l2', startId: 'r2', endId: 'r3' },
    { kind: 'line', id: 'l3', startId: 'r3', endId: 'r4' },
    { kind: 'line', id: 'l4', startId: 'r4', endId: 'r1' },
    ...SPLINE_POINTS.map(([id, x, y]): SketchEntity => ({ kind: 'point', id, x, y })),
    { kind: 'spline', id: 'spl1', controlPointIds: [...CLOSED_SPLINE_IDS], degree: 3 },
  ];
  return { entities, constraints: [] };
}

// ── Test-local evaluators ───────────────────────────────────────────────────

function cubicAt(p: Array<{ x: number; y: number }>, t: number): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p[0].x + 3 * mt * mt * t * p[1].x + 3 * mt * t * t * p[2].x + t * t * t * p[3].x,
    y: mt * mt * mt * p[0].y + 3 * mt * mt * t * p[1].y + 3 * mt * t * t * p[2].y + t * t * t * p[3].y,
  };
}

// Clamped uniform knot vector — same convention as tessellateSpline.
function clampedKnots(n: number, degree: number): number[] {
  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let i = 1; i <= n - degree - 1; i++) knots.push(i);
  for (let i = 0; i <= degree; i++) knots.push(n - degree);
  return knots;
}

// De Boor evaluation (mirrors tessellator.ts) — the reference curve the
// Bézier conversion must trace exactly.
function deBoor(
  pts: Array<{ x: number; y: number }>, knots: number[], p: number, u: number,
): { x: number; y: number } {
  let k = p;
  for (; k < knots.length - p - 1; k++) {
    if (u < knots[k + 1]) break;
  }
  const d: Array<{ x: number; y: number }> = [];
  for (let j = 0; j <= p; j++) {
    const idx = Math.min(Math.max(k - p + j, 0), pts.length - 1);
    d.push({ x: pts[idx].x, y: pts[idx].y });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const denom = knots[j + 1 + k - r] - knots[j + k - p];
      const alpha = denom < 1e-12 ? 0 : (u - knots[j + k - p]) / denom;
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
      };
    }
  }
  return d[p];
}

function asBezierEdges(loop: ProfileLoop): BezierProfileEdge[] {
  return loop.map(e => {
    expect(e.kind).toBe('bezier');
    return e as BezierProfileEdge;
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('curveBeziers (REQ 883)', () => {
  it('pins kappa', () => {
    expect(KAPPA).toBe(0.5522847498307936);
  });

  it('converts a 5-point clamped cubic B-spline to the two known Bézier segments', () => {
    // Hand-derived via Böhm insertion of the single interior knot (u=1) twice:
    //   seg0 = [P0, P1, (P1+P2)/2, (P1+2·P2+P3)/4]
    //   seg1 = [(P1+2·P2+P3)/4, (P2+P3)/2, P3, P4]
    const cps = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 8 }, { x: 0, y: 8 },
    ];
    const segs = bezierSegsFromSpline(cps, 3);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(2);
    expect(segs![0]).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 2 }, { x: 6, y: 4 },
    ]);
    expect(segs![1]).toEqual([
      { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 8 }, { x: 0, y: 8 },
    ]);
  });

  it('passes 4 control points through as a single Bézier', () => {
    const cps = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 0 }];
    const segs = bezierSegsFromSpline(cps, 3);
    expect(segs).toEqual([cps]);
  });

  it('converted Béziers trace the exact clamped B-spline (de Boor cross-check)', () => {
    const cps = CLOSED_SPLINE_IDS.map(id => {
      const [, x, y] = SPLINE_POINTS.find(([pid]) => pid === id)!;
      return { x, y };
    });
    const segs = bezierSegsFromSpline(cps, 3)!;
    expect(segs.length).toBe(cps.length - 3);
    const knots = clampedKnots(cps.length, 3);
    for (let j = 0; j < segs.length; j++) {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const got = cubicAt(segs[j], t);
        const want = deBoor(cps, knots, 3, j + t);
        expect(got.x).toBeCloseTo(want.x, 9);
        expect(got.y).toBeCloseTo(want.y, 9);
      }
    }
    // Curve end interpolates the last control point (== the first: closed).
    const end = cubicAt(segs[segs.length - 1], 1);
    expect(end.x).toBeCloseTo(cps[cps.length - 1].x, 9);
    expect(end.y).toBeCloseTo(cps[cps.length - 1].y, 9);
  });

  it('returns null for non-cubic spline degrees (v1 scope)', () => {
    const cps = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 8 }, { x: 0, y: 8 }];
    expect(bezierSegsFromSpline(cps, 2)).toBeNull();
    expect(bezierSegsFromSpline(cps.slice(0, 3), 3)).toBeNull();  // too few points
  });

  it('ellipse control points match the pinned kappa construction (axis-aligned)', () => {
    const segs = bezierSegsFromEllipse({ x: 0, y: 0 }, { x: 8, y: 0 }, 4);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(4);
    const ka = 8 * 0.5522847498307936;
    const kb = 4 * 0.5522847498307936;
    const expectPt = (p: { x: number; y: number }, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 12);
      expect(p.y).toBeCloseTo(y, 12);
    };
    // Quadrant 1: major-axis end → minor-axis end, CCW.
    expectPt(segs![0][0], 8, 0);
    expectPt(segs![0][1], 8, kb);
    expectPt(segs![0][2], ka, 4);
    expectPt(segs![0][3], 0, 4);
    // Remaining quadrants continue the CCW chain and close.
    expectPt(segs![1][3], -8, 0);
    expectPt(segs![2][3], 0, -4);
    expectPt(segs![3][3], 8, 0);
  });

  it('returns null for a degenerate ellipse', () => {
    expect(bezierSegsFromEllipse({ x: 0, y: 0 }, { x: 0, y: 0 }, 4)).toBeNull();
    expect(bezierSegsFromEllipse({ x: 0, y: 0 }, { x: 8, y: 0 }, 0)).toBeNull();
  });
});

describe('profile extraction — curve profiles (REQ 883)', () => {
  it('closed cubic spline yields one region of bezier edges chaining head-to-tail and closing', () => {
    const { regions, errors } = extractRegions(closedSplineState());
    expect(errors).toEqual([]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes).toEqual([]);
    const edges = asBezierEdges(regions[0].outer);
    expect(edges.length).toBe(4);  // 7 control points → n−3 cubic spans
    for (const e of edges) expect(e.points.length).toBe(4);
    for (let i = 0; i < edges.length; i++) {
      const prev = edges[(i + edges.length - 1) % edges.length].points;
      const cur = edges[i].points;
      expect(cur[0].x).toBeCloseTo(prev[3].x, 9);
      expect(cur[0].y).toBeCloseTo(prev[3].y, 9);
    }
    // Loop starts/ends at the shared first/last control point.
    expect(edges[0].points[0].x).toBeCloseTo(110, 9);
    expect(edges[0].points[0].y).toBeCloseTo(0, 9);
    // Region loop deep-equals the raw conversion (same objects feed both).
    const cps = CLOSED_SPLINE_IDS.map(id => {
      const [, x, y] = SPLINE_POINTS.find(([pid]) => pid === id)!;
      return { x, y };
    });
    const segs = bezierSegsFromSpline(cps, 3)!;
    expect(regions[0].outer).toEqual(segs.map(points => ({ kind: 'bezier', points })));
  });

  it('ellipse yields one region of 4 bezier edges within 5e-4·a of the true radius', () => {
    const { regions, errors } = extractRegions(ellipseState());
    expect(errors).toEqual([]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes).toEqual([]);
    const edges = asBezierEdges(regions[0].outer);
    expect(edges.length).toBe(4);
    // Chain closes.
    for (let i = 0; i < edges.length; i++) {
      const prev = edges[(i + edges.length - 1) % edges.length].points;
      expect(edges[i].points[0].x).toBeCloseTo(prev[3].x, 9);
      expect(edges[i].points[0].y).toBeCloseTo(prev[3].y, 9);
    }
    // Radial accuracy: sample each Bézier; compare |p−C| against the true
    // ellipse radius at the same ellipse-frame polar angle. The kappa
    // construction's relative radial error is ~2.7e-4, so 5e-4·a bounds it.
    const ux = (ELLIPSE_MX - ELLIPSE_CX) / ELLIPSE_A;
    const uy = (ELLIPSE_MY - ELLIPSE_CY) / ELLIPSE_A;
    const vx = -uy, vy = ux;
    for (const e of edges) {
      for (let s = 0; s <= 20; s++) {
        const p = cubicAt(e.points, s / 20);
        const dx = p.x - ELLIPSE_CX, dy = p.y - ELLIPSE_CY;
        const xi = dx * ux + dy * uy;
        const eta = dx * vx + dy * vy;
        const theta = Math.atan2(eta, xi);
        const rTrue = (ELLIPSE_A * ELLIPSE_B)
          / Math.hypot(ELLIPSE_B * Math.cos(theta), ELLIPSE_A * Math.sin(theta));
        expect(Math.abs(Math.hypot(dx, dy) - rTrue)).toBeLessThanOrEqual(5e-4 * ELLIPSE_A);
      }
    }
  });

  it('open spline contributes no region', () => {
    const { regions, errors } = extractRegions(openSplineState());
    expect(errors).toEqual([]);
    expect(regions.length).toBe(0);
  });

  it('emit order: curve loops precede arrangement faces (rectangle + closed spline)', () => {
    // EMIT-ORDER RULE (pinned identically in cad-profile-curves.test.js):
    // text glyph loops, then curve loops (closed splines + ellipses, in
    // sketch entity order), then standalone circles, then arrangement faces.
    const { regions, errors } = extractRegions(rectAndSplineState());
    expect(errors).toEqual([]);
    expect(regions.length).toBe(2);
    expect(regions[0].outer.every(e => e.kind === 'bezier')).toBe(true);  // spline first
    expect(regions[1].outer.every(e => e.kind === 'line')).toBe(true);    // rectangle after
    expect(regions[1].outer.length).toBe(4);
  });
});
