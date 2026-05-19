import type {
  SketchState, SketchEntity, PointEntity, LineEntity, CircleEntity, ArcEntity,
  EllipseEntity, SplineEntity,
} from './types';
import { findPoint } from './types';
import { tessellateEllipse, tessellateSpline, DEFAULT_CHORD_TOLERANCE } from './tessellator';

// ────────────────────────────────────────────────────────────────────────────
// Parametric closest-point picker (REQ 564).
//
// Hit-testing is done against each entity's parametric definition, NOT against
// its rendered tessellation. This decouples pick accuracy from chord tolerance:
// a coarsely-tessellated circle still picks at the analytic boundary.
// ────────────────────────────────────────────────────────────────────────────

export interface Point2 { x: number; y: number; }

const PICK_RANK: Record<SketchEntity['kind'], number> = {
  point: 0,
  line: 1,
  circle: 1,
  arc: 1,
  ellipse: 1,
  ellipticalArc: 1,
  spline: 1,
  conic: 1,
};

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToPoint(_state: SketchState, e: PointEntity, p: Point2): number {
  return dist(e, p);
}

function distanceToLine(state: SketchState, e: LineEntity, p: Point2): number {
  const a = findPoint(state, e.startId);
  const b = findPoint(state, e.endId);
  if (!a || !b) return Infinity;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(a, p);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj = { x: a.x + dx * t, y: a.y + dy * t };
  return dist(proj, p);
}

function distanceToCircle(state: SketchState, e: CircleEntity, p: Point2): number {
  const c = findPoint(state, e.centerId);
  if (!c) return Infinity;
  return Math.abs(dist(c, p) - e.radius);
}

function angleNorm(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
}

function distanceToArc(state: SketchState, e: ArcEntity, p: Point2): number {
  const c = findPoint(state, e.centerId);
  const s = findPoint(state, e.startId);
  const f = findPoint(state, e.endId);
  if (!c || !s || !f) return Infinity;
  const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
  const endAngle = Math.atan2(f.y - c.y, f.x - c.x);
  const pointAngle = Math.atan2(p.y - c.y, p.x - c.x);
  // Normalize sweep relative to start; arc covers [0, sweep) in CCW direction
  // (or the reverse for CW). Re-express the point's angle in the same window.
  let sweep = endAngle - startAngle;
  if (e.ccw) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  let pointOffset = pointAngle - startAngle;
  if (e.ccw) {
    while (pointOffset < 0) pointOffset += Math.PI * 2;
    while (pointOffset > Math.PI * 2) pointOffset -= Math.PI * 2;
    if (pointOffset <= sweep) {
      return Math.abs(dist(c, p) - e.radius);
    }
  } else {
    while (pointOffset > 0) pointOffset -= Math.PI * 2;
    while (pointOffset < -Math.PI * 2) pointOffset += Math.PI * 2;
    if (pointOffset >= sweep) {
      return Math.abs(dist(c, p) - e.radius);
    }
  }
  // Outside sweep → distance to the nearer endpoint.
  return Math.min(dist(s, p), dist(f, p));
}

function distanceToEllipse(state: SketchState, e: EllipseEntity, p: Point2): number {
  const c = findPoint(state, e.centerId);
  const m = findPoint(state, e.majorAxisEndId);
  if (!c || !m) return Infinity;
  // Approximate via tessellation — sufficient for clicks at screen tolerance.
  // True closest-point on an ellipse requires iterative root-finding (no
  // closed form); not worth the complexity for pick hit-testing.
  const samples = tessellateEllipse({ x: c.x, y: c.y }, { x: m.x, y: m.y }, e.minorRadius, DEFAULT_CHORD_TOLERANCE);
  return distanceToPolyline(samples, p);
}

function distanceToSpline(state: SketchState, e: SplineEntity, p: Point2): number {
  const pts = e.controlPointIds.map(id => findPoint(state, id)).filter((q): q is PointEntity => !!q);
  if (pts.length < e.degree + 1) return Infinity;
  const samples = tessellateSpline(pts.map(q => ({ x: q.x, y: q.y })), e.degree, DEFAULT_CHORD_TOLERANCE);
  return distanceToPolyline(samples, p);
}

function distanceToPolyline(samples: Array<{ x: number; y: number }>, p: Point2): number {
  if (samples.length === 0) return Infinity;
  let min = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 < 1e-12 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(proj.x - p.x, proj.y - p.y);
    if (d < min) min = d;
  }
  return min;
}

export function distanceToEntity(state: SketchState, entity: SketchEntity, p: Point2): number {
  switch (entity.kind) {
    case 'point': return distanceToPoint(state, entity, p);
    case 'line': return distanceToLine(state, entity, p);
    case 'circle': return distanceToCircle(state, entity, p);
    case 'arc': return distanceToArc(state, entity, p);
    case 'ellipse': return distanceToEllipse(state, entity, p);
    case 'spline': return distanceToSpline(state, entity, p);
    case 'ellipticalArc':
    case 'conic':
      // Phase C — exact closest-point per kind.
      return Infinity;
  }
}

/**
 * Pick the entity nearest to `p`, with two tweaks vs. plain nearest-search:
 *
 * 1. **Points strongly preferred.** If ANY point lies within `pointTolerance`
 *    (defaulting to `tolerance`), the closest such point wins outright —
 *    even if a line happens to be closer. Otherwise clicking near a corner
 *    sometimes grabs the line passing through that corner, which never
 *    matches the user's intent.
 *
 * 2. **Pick rank as the tiebreaker.** When two non-point entities are
 *    equidistant, the lower-rank one wins (points > lines/curves > rest).
 */
export function pickEntity(
  state: SketchState, p: Point2, tolerance: number,
  pointTolerance: number = tolerance,
): SketchEntity | null {
  // Pass 1 — point preference within pointTolerance.
  let bestPoint: SketchEntity | null = null;
  let bestPointDist = Infinity;
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    const d = distanceToEntity(state, e, p);
    if (d > pointTolerance) continue;
    if (d < bestPointDist) { bestPoint = e; bestPointDist = d; }
  }
  if (bestPoint) return bestPoint;

  // Pass 2 — fall back to the regular nearest-by-distance among all kinds.
  let best: SketchEntity | null = null;
  let bestDist = Infinity;
  let bestRank = Infinity;
  for (const e of state.entities) {
    const d = distanceToEntity(state, e, p);
    if (d > tolerance) continue;
    const rank = PICK_RANK[e.kind];
    if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) < 1e-9 && rank < bestRank)) {
      best = e;
      bestDist = d;
      bestRank = rank;
    }
  }
  return best;
}
