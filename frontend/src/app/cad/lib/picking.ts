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
  text: 2,           // reference rows beneath curves
  picture: 3,        // background, last
  equation: 1,
  intersection: 1,
  splineOnSurface: 1,
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
      return Infinity;
    case 'conic':
      return distanceToConic(state, entity, p);
    case 'equation':
      return distanceToPolyline(tessellateEquationCurveExternal(entity.xExpr, entity.yExpr, entity.tMin, entity.tMax, entity.samples), p);
    case 'text':
      return distanceToTextBBox(state, entity, p);
    case 'picture':
      return distanceToPictureBBox(state, entity, p);
    case 'intersection':
    case 'splineOnSurface':
      // 3D-only entities — viewer handles their selection.
      return Infinity;
  }
}

/** Distance to the text's bounding rect. New flow uses the 4 real
 * corner points; legacy flow falls back to (anchor, approximated
 * width via text.length * size * 0.55). Inside = 0. */
function distanceToTextBBox(
  state: SketchState, e: import('./types').TextEntity, p: Point2,
): number {
  if (e.cornerIds && e.cornerIds.length === 4) {
    const corners = e.cornerIds.map(id => pt(state, id));
    if (corners.some(c => !c)) return Infinity;
    const xs = corners.map(c => c!.x);
    const ys = corners.map(c => c!.y);
    return rectDistance(p, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  if (!e.anchorId || e.size === undefined) return Infinity;
  const a = pt(state, e.anchorId);
  if (!a) return Infinity;
  const w = Math.max(0.5, e.text.length * e.size * 0.55);
  const h = e.size;
  return rectDistance(p, a.x, a.y, a.x + w, a.y + h);
}

function distanceToPictureBBox(
  state: SketchState, e: import('./types').PictureEntity, p: Point2,
): number {
  const a = pt(state, e.anchorId);
  if (!a) return Infinity;
  // Rotation: rotate p into the picture's local frame before bbox
  // testing. Origin at anchor.
  const c = Math.cos(-e.rotation), s = Math.sin(-e.rotation);
  const lx = (p.x - a.x) * c - (p.y - a.y) * s;
  const ly = (p.x - a.x) * s + (p.y - a.y) * c;
  return rectDistance({ x: lx, y: ly }, 0, 0, e.width, e.height);
}

function rectDistance(p: Point2, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(x0 - p.x, 0, p.x - x1);
  const dy = Math.max(y0 - p.y, 0, p.y - y1);
  return Math.hypot(dx, dy);
}

/** Distance from `p` to the parabola tessellation. Cheap brute-force
 * over the polyline samples — accurate enough for hit-test
 * tolerances. */
function distanceToConic(state: SketchState, entity: import('./types').ConicEntity, p: Point2): number {
  if (entity.conicType !== 'parabola') return Infinity;
  // Mirror tessellateParabola without pulling in the import cycle.
  const v = pt(state, entity.pointIds[0]);
  const f = pt(state, entity.pointIds[1]);
  const s = pt(state, entity.pointIds[2]);
  if (!v || !f || !s) return Infinity;
  const ax = f.x - v.x, ay = f.y - v.y;
  const focal = Math.hypot(ax, ay);
  if (focal < 1e-9) return Infinity;
  const ux = ax / focal, uy = ay / focal;
  const nx = -uy, ny = ux;
  const dx = s.x - v.x, dy = s.y - v.y;
  const sLocalX = dx * nx + dy * ny;
  if (Math.abs(sLocalX) < 1e-9) return Infinity;
  const halfWidth = Math.abs(sLocalX);
  const segs = 64;
  const poly: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * 2 - 1;
    const lx = t * halfWidth;
    const ly = (lx * lx) / (4 * focal);
    poly.push({ x: v.x + nx * lx + ux * ly, y: v.y + ny * lx + uy * ly });
  }
  return distanceToPolyline(poly, p);
}
function pt(state: SketchState, id: string): Point2 | null {
  const e = state.entities.find(e => e.id === id);
  if (!e || e.kind !== 'point') return null;
  return { x: e.x, y: e.y };
}
/** Avoid circular import via the tessellator by inlining the
 * equation eval here. Same algorithm as tessellateEquationCurve. */
function tessellateEquationCurveExternal(
  xExpr: string, yExpr: string, tMin: number, tMax: number, samples: number,
): Array<{ x: number; y: number }> {
  const n = Math.max(8, Math.min(2000, Math.floor(samples)));
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return [];
  let fx: (t: number) => number, fy: (t: number) => number;
  try {
    fx = new Function('t', `with (Math) { return (${xExpr}); }`) as any;
    fy = new Function('t', `with (Math) { return (${yExpr}); }`) as any;
  } catch { return []; }
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = tMin + (i / n) * (tMax - tMin);
    let x: number, y: number;
    try { x = fx(t); y = fy(t); } catch { continue; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
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

  // Pass 2 — nearest within tolerance, but RANK DOMINATES so a curve/line
  // always wins over a text/picture it overlaps. Text/picture bounding boxes
  // return distance 0 across their whole interior, so a distance-first rule
  // would let them "absorb" every click and make the border construction lines
  // (and centerline) unselectable. Distance only breaks ties within a rank.
  let best: SketchEntity | null = null;
  let bestDist = Infinity;
  let bestRank = Infinity;
  for (const e of state.entities) {
    const d = distanceToEntity(state, e, p);
    if (d > tolerance) continue;
    const rank = PICK_RANK[e.kind];
    if (rank < bestRank || (rank === bestRank && d < bestDist - 1e-9)) {
      best = e;
      bestDist = d;
      bestRank = rank;
    }
  }
  return best;
}
