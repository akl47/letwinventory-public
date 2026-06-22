import type {
  SketchState, LineEntity, CircleEntity, ArcEntity,
} from './types';
import { findPoint } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Pure-geometry primitives used by the sketch editing tools (Trim, Extend,
// Mirror, Offset, Fillet, Split) and by snap detection. No store / signal /
// DOM dependencies — everything is `Pt` arithmetic so the algorithms are
// easy to test in isolation. UI wiring lives in `sketchEditOps.ts` and the
// editor component.
// ────────────────────────────────────────────────────────────────────────────

export interface Pt { x: number; y: number; }

const EPS = 1e-9;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Reflect point `p` across the infinite line through `a` and `b`. Used by
 * the Mirror tool. */
export function reflectAcrossLine(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const foot = { x: a.x + dx * t, y: a.y + dy * t };
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}

/**
 * Intersect two infinite lines (each defined by two endpoints). Returns
 * the parametric coords t1, t2 along each line plus the world point.
 * `t=0` is line.start, `t=1` is line.end. Returns null when parallel.
 *
 * Trim/Extend test the segment-internal hit by checking `0 < t < 1`;
 * extension hits use `t < 0 || t > 1`.
 */
export function lineLineIntersection(
  a1: Pt, a2: Pt, b1: Pt, b2: Pt,
): { p: Pt; t1: number; t2: number } | null {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return null;
  const dx = b1.x - a1.x, dy = b1.y - a1.y;
  const t1 = (dx * s.y - dy * s.x) / denom;
  const t2 = (dx * r.y - dy * r.x) / denom;
  return { p: { x: a1.x + t1 * r.x, y: a1.y + t1 * r.y }, t1, t2 };
}

/** Intersect a line (a1→a2) with a circle (center, radius). Returns 0-2
 * intersection points, in the order they appear along the line direction. */
export function lineCircleIntersection(
  a1: Pt, a2: Pt, center: Pt, radius: number,
): Pt[] {
  const dx = a2.x - a1.x, dy = a2.y - a1.y;
  const fx = a1.x - center.x, fy = a1.y - center.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < EPS) return [];
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  const t2 = (-B + sq) / (2 * A);
  const pts: Pt[] = [];
  pts.push({ x: a1.x + t1 * dx, y: a1.y + t1 * dy });
  if (Math.abs(t2 - t1) > EPS) pts.push({ x: a1.x + t2 * dx, y: a1.y + t2 * dy });
  return pts;
}

/** Intersect two circles. Returns 0, 1, or 2 points. */
export function circleCircleIntersection(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d + EPS < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = c1.x + a * (c2.x - c1.x) / d;
  const my = c1.y + a * (c2.y - c1.y) / d;
  const rx = -(c2.y - c1.y) * (h / d);
  const ry =  (c2.x - c1.x) * (h / d);
  if (h < EPS) return [{ x: mx, y: my }];
  return [{ x: mx + rx, y: my + ry }, { x: mx - rx, y: my - ry }];
}

/** Test whether an angle (radians, normalized in [0, 2π)) lies within the
 * arc's CCW or CW sweep from start→end. Used to filter line-circle hits
 * down to line-arc hits in Trim/Extend. */
export function angleInArcSweep(
  pointAngle: number, startAngle: number, endAngle: number, ccw: boolean,
): boolean {
  const TAU = Math.PI * 2;
  const norm = (a: number) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
  if (ccw) {
    const sweep = norm(endAngle - startAngle);
    const off = norm(pointAngle - startAngle);
    return off <= sweep + EPS;
  } else {
    const sweep = norm(startAngle - endAngle);
    const off = norm(startAngle - pointAngle);
    return off <= sweep + EPS;
  }
}

/** All intersection points between every pair of curves in the state
 * (construction curves included — they're full snap targets, like normal
 * geometry). Used by snap-to-intersection. Lines are treated as bounded
 * segments; circles as full circles; arcs are filtered by sweep. */
export function allCurveIntersections(state: SketchState): Pt[] {
  interface Seg { a: Pt; b: Pt; }
  interface Circ { c: Pt; r: number; isArc: false; }
  interface Arc { c: Pt; r: number; start: number; end: number; ccw: boolean; isArc: true; }
  const lines: Seg[] = [];
  const circles: Array<Circ | Arc> = [];
  for (const e of state.entities) {
    if (e.kind === 'line') {
      const a = findPoint(state, (e as LineEntity).startId);
      const b = findPoint(state, (e as LineEntity).endId);
      if (a && b) lines.push({ a, b });
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, (e as CircleEntity).centerId);
      if (ce) circles.push({ c: ce, r: (e as CircleEntity).radius, isArc: false });
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const ce = findPoint(state, ae.centerId);
      const s = findPoint(state, ae.startId);
      const f = findPoint(state, ae.endId);
      if (ce && s && f) {
        circles.push({
          c: ce, r: ae.radius,
          start: Math.atan2(s.y - ce.y, s.x - ce.x),
          end: Math.atan2(f.y - ce.y, f.x - ce.x),
          ccw: ae.ccw, isArc: true,
        });
      }
    }
  }

  const out: Pt[] = [];
  const inSegment = (p: Pt, ln: Seg) => {
    const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return false;
    const t = ((p.x - ln.a.x) * dx + (p.y - ln.a.y) * dy) / len2;
    return t > EPS && t < 1 - EPS;
  };
  const onArc = (p: Pt, ci: Circ | Arc) => {
    if (!ci.isArc) return true;
    const a = Math.atan2(p.y - ci.c.y, p.x - ci.c.x);
    return angleInArcSweep(a, ci.start, ci.end, ci.ccw);
  };

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const r = lineLineIntersection(lines[i].a, lines[i].b, lines[j].a, lines[j].b);
      if (r && r.t1 > EPS && r.t1 < 1 - EPS && r.t2 > EPS && r.t2 < 1 - EPS) out.push(r.p);
    }
  }
  for (const ln of lines) {
    for (const ci of circles) {
      const pts = lineCircleIntersection(ln.a, ln.b, ci.c, ci.r);
      for (const p of pts) {
        if (inSegment(p, ln) && onArc(p, ci)) out.push(p);
      }
    }
  }
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const ci = circles[i], cj = circles[j];
      const pts = circleCircleIntersection(ci.c, ci.r, cj.c, cj.r);
      for (const p of pts) {
        if (onArc(p, ci) && onArc(p, cj)) out.push(p);
      }
    }
  }
  return out;
}

/** Midpoint of a non-construction line. */
export function lineMidpoint(state: SketchState, l: LineEntity): Pt | null {
  const a = findPoint(state, l.startId);
  const b = findPoint(state, l.endId);
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Four cardinal "quadrant" points on a circle (top/bottom/left/right). */
export function circleQuadrants(center: Pt, radius: number): Pt[] {
  return [
    { x: center.x + radius, y: center.y },
    { x: center.x - radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x, y: center.y - radius },
  ];
}

/** Closest point on the segment a→b to p, plus the t parameter [0, 1]. */
export function projectOntoSegment(a: Pt, b: Pt, p: Pt): { p: Pt; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { p: { x: a.x, y: a.y }, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { p: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** Closest point on the infinite line through a and b (NOT clamped to the
 * segment). Returns the foot of the perpendicular and the unclamped
 * parameter. Used by Extend to find the projection of the cut point onto
 * the line being extended. */
export function projectOntoLine(a: Pt, b: Pt, p: Pt): { p: Pt; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { p: { x: a.x, y: a.y }, t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { p: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** Offset a line by `d` to its left (CCW perpendicular to a→b direction). */
export function offsetLineLeft(a: Pt, b: Pt, d: number): { a: Pt; b: Pt } | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  const nx = -dy / len, ny = dx / len;
  return { a: { x: a.x + nx * d, y: a.y + ny * d }, b: { x: b.x + nx * d, y: b.y + ny * d } };
}
