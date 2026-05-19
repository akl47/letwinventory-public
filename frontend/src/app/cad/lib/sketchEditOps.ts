import type {
  SketchState, SketchEntity, LineEntity, CircleEntity, ArcEntity, PointEntity,
} from './types';
import { findEntity, findPoint } from './types';
import {
  addPoint, addLine, addArc, addArcByPoints, addCircle, addCircleByPoint,
  addEllipseByPoints, addSplineByPoints, addConstraint, deletePrimitive,
  ORIGIN_POINT_ID,
} from './store';
import type { Pt } from './geometry';
import {
  lineLineIntersection, lineCircleIntersection, circleCircleIntersection,
  angleInArcSweep, projectOntoSegment, reflectAcrossLine,
} from './geometry';

const EPS = 1e-9;

// ────────────────────────────────────────────────────────────────────────────
// Pure-function sketch editing operations: Trim, Extend, Split, Mirror.
//
// Each function takes a `SketchState`, performs the operation, and returns a
// new `SketchState`. Failures (no intersection found, can't extend, etc.)
// return the input state unchanged plus an `error` field; callers surface
// these as user-facing toasts. UI wiring lives in the editor component;
// these functions are pure so they can be unit-tested in isolation.
// ────────────────────────────────────────────────────────────────────────────

export interface OpResult {
  state: SketchState;
  error?: string;
  /** IDs of entities created or modified by the operation. Useful for
   * selecting the result after a tool runs. */
  affectedIds?: string[];
  /** IDs of construction lines added by the operation, in creation order.
   * Set by chamferLines / filletLines when `keepRemovedAsConstruction` is
   * on, so callers can chain equal-length constraints across multi-corner
   * chamfers / fillets. */
  constructionLineIds?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Hover-preview helpers — pure functions that return the geometry of the
// segment that Trim/Extend WOULD affect under the cursor, without mutating
// state. Returned as Pt-pairs for the renderer; lines only for now (most
// common case). Circles/arcs preview added later.
// ────────────────────────────────────────────────────────────────────────────

/** What the Trim tool would remove if the user clicks on `lineId` at
 * `clickPoint`. Returns the endpoints of the segment-to-be-cut, or null when
 * no preview is available (entity isn't a line, not found, etc). The
 * algorithm mirrors `trimLine` — see that function for case rationale. */
export function previewTrimLine(state: SketchState, lineId: string, clickPoint: Pt): { start: Pt; end: Pt } | null {
  const line = findEntity<LineEntity>(state, lineId);
  if (!line || line.kind !== 'line' || line.construction) return null;
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return null;

  const hits = collectLineHits(state, line, a, b);
  const proj = projectOntoSegment(a, b, clickPoint);
  const tClick = proj.t;
  if (hits.length === 0) return { start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } };

  let leftHit: number | null = null;
  let rightHit: number | null = null;
  for (const t of hits) {
    if (t < tClick - EPS) {
      if (leftHit === null || t > leftHit) leftHit = t;
    } else if (t > tClick + EPS) {
      if (rightHit === null || t < rightHit) rightHit = t;
    }
  }
  let t0: number, t1: number;
  if (leftHit !== null && rightHit !== null) { t0 = leftHit; t1 = rightHit; }
  else if (leftHit === null && rightHit !== null) { t0 = 0; t1 = rightHit; }
  else if (leftHit !== null && rightHit === null) { t0 = leftHit; t1 = 1; }
  else return null;

  return {
    start: { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
    end:   { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
  };
}

/** What the Extend tool would add if the user clicks `lineId` at
 * `clickPoint`. Returns the segment from the existing endpoint (the one
 * nearer the click) to the projected new endpoint, or null when no
 * boundary exists. Mirrors `extendLine`. */
export function previewExtendLine(state: SketchState, lineId: string, clickPoint: Pt): { start: Pt; end: Pt } | null {
  const line = findEntity<LineEntity>(state, lineId);
  if (!line || line.kind !== 'line' || line.construction) return null;
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return null;

  const da = (clickPoint.x - a.x) ** 2 + (clickPoint.y - a.y) ** 2;
  const db = (clickPoint.x - b.x) ** 2 + (clickPoint.y - b.y) ** 2;
  const extendStart = da < db;
  const candidates: number[] = [];
  for (const e of state.entities) {
    if (e.id === line.id || e.construction) continue;
    if (e.kind === 'line') {
      const oa = findPoint(state, e.startId);
      const ob = findPoint(state, e.endId);
      if (!oa || !ob) continue;
      const r = lineLineIntersection(a, b, oa, ob);
      if (!r) continue;
      if (r.t2 < -EPS || r.t2 > 1 + EPS) continue;
      if (extendStart && r.t1 < -EPS) candidates.push(r.t1);
      if (!extendStart && r.t1 > 1 + EPS) candidates.push(r.t1);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      const ce = findPoint(state, (e as CircleEntity | ArcEntity).centerId);
      if (!ce) continue;
      const radius = (e as CircleEntity | ArcEntity).radius;
      const pts = lineCircleIntersection(a, b, ce, radius);
      let validPts = pts;
      if (e.kind === 'arc') {
        const ae = e as ArcEntity;
        const sp = findPoint(state, ae.startId);
        const ep = findPoint(state, ae.endId);
        if (!sp || !ep) continue;
        const sa = Math.atan2(sp.y - ce.y, sp.x - ce.x);
        const ea = Math.atan2(ep.y - ce.y, ep.x - ce.x);
        validPts = pts.filter(p => {
          const ang = Math.atan2(p.y - ce.y, p.x - ce.x);
          return angleInArcSweep(ang, sa, ea, ae.ccw);
        });
      }
      for (const p of validPts) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < EPS) continue;
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        if (extendStart && t < -EPS) candidates.push(t);
        if (!extendStart && t > 1 + EPS) candidates.push(t);
      }
    }
  }
  if (candidates.length === 0) return null;
  const targetT = extendStart
    ? candidates.reduce((acc, x) => x > acc ? x : acc, -Infinity)
    : candidates.reduce((acc, x) => x < acc ? x : acc, +Infinity);
  const newPoint = { x: a.x + (b.x - a.x) * targetT, y: a.y + (b.y - a.y) * targetT };
  // Preview = (existing endpoint) → (projected new endpoint).
  const endpoint = extendStart ? a : b;
  return { start: { x: endpoint.x, y: endpoint.y }, end: newPoint };
}

// ────────────────────────────────────────────────────────────────────────────
// Trim
// ────────────────────────────────────────────────────────────────────────────
// SolidWorks behavior: click a portion of a curve between two intersections;
// that portion is removed. If the click is on a "stub" past the last
// intersection, the stub is removed (the curve is shortened to its nearest
// intersection). If there are no intersections at all, the entire curve is
// deleted.

/**
 * Trim the curve under `clickPoint`. Returns a new state with the relevant
 * curve segment removed/shortened. Supports lines, circles, and arcs.
 */
export function trimAt(state: SketchState, entityId: string, clickPoint: Pt): OpResult {
  const e = findEntity(state, entityId);
  if (!e) return { state, error: 'Entity not found' };
  if (e.construction) return { state, error: 'Cannot trim construction geometry' };
  switch (e.kind) {
    case 'line':   return trimLine(state, e as LineEntity, clickPoint);
    case 'circle': return trimCircle(state, e as CircleEntity, clickPoint);
    case 'arc':    return trimArc(state, e as ArcEntity, clickPoint);
    default:       return { state, error: `Trim not supported for ${e.kind}` };
  }
}

function trimLine(state: SketchState, line: LineEntity, click: Pt): OpResult {
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return { state, error: 'Line endpoints missing' };

  // Find every intersection of this line with another non-construction
  // curve, in the line's parameter space.
  const hits = collectLineHits(state, line, a, b);
  if (hits.length === 0) {
    // No neighbors → trim deletes the whole line.
    return { state: deletePrimitive(state, line.id), affectedIds: [] };
  }

  // Click parameter along the line.
  const proj = projectOntoSegment(a, b, click);
  const tClick = proj.t;

  // Find the nearest hits on either side of the click.
  let leftHit: number | null = null;   // largest hit < tClick
  let rightHit: number | null = null;  // smallest hit > tClick
  for (const t of hits) {
    if (t < tClick - EPS) {
      if (leftHit === null || t > leftHit) leftHit = t;
    } else if (t > tClick + EPS) {
      if (rightHit === null || t < rightHit) rightHit = t;
    }
  }

  // Case A: both sides bounded → split into two segments and drop the
  // middle piece (the segment under the cursor).
  if (leftHit !== null && rightHit !== null) {
    return splitLineKeepingOnly(state, line, a, b, [
      [0, leftHit], [rightHit, 1],
    ]);
  }
  // Case B: only one side bounded → drop the stub the click is on.
  if (leftHit === null && rightHit !== null) {
    // Click sits to the left of every hit → shorten by moving start to rightHit.
    return splitLineKeepingOnly(state, line, a, b, [[rightHit, 1]]);
  }
  if (leftHit !== null && rightHit === null) {
    return splitLineKeepingOnly(state, line, a, b, [[0, leftHit]]);
  }
  // Shouldn't be reachable.
  return { state, error: 'Trim could not classify click' };
}

/** Replace `line` with one or more sub-segments specified as t-parameter
 * pairs along the original. Each kept segment becomes a new line entity. */
function splitLineKeepingOnly(
  state: SketchState, line: LineEntity, a: Pt, b: Pt,
  kept: Array<[number, number]>,
): OpResult {
  let s = deletePrimitive(state, line.id);
  const newIds: string[] = [];
  for (const [t0, t1] of kept) {
    if (Math.abs(t1 - t0) < EPS) continue;
    const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
    const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
    const pa = addPoint(s, p0.x, p0.y); s = pa.state;
    const pb = addPoint(s, p1.x, p1.y); s = pb.state;
    const lr = addLine(s, pa.id, pb.id); s = lr.state;
    newIds.push(lr.id);
  }
  return { state: s, affectedIds: newIds };
}

/** Hit parameters (t in [0,1]) where `line` is crossed by every other
 * non-construction curve. Excludes endpoint touches. */
function collectLineHits(
  state: SketchState, line: LineEntity, a: Pt, b: Pt,
): number[] {
  const out: number[] = [];
  for (const e of state.entities) {
    if (e.id === line.id || e.construction) continue;
    if (e.kind === 'line') {
      const oa = findPoint(state, e.startId);
      const ob = findPoint(state, e.endId);
      if (!oa || !ob) continue;
      const r = lineLineIntersection(a, b, oa, ob);
      if (!r) continue;
      if (r.t1 > EPS && r.t1 < 1 - EPS && r.t2 > EPS && r.t2 < 1 - EPS) {
        out.push(r.t1);
      }
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, (e as CircleEntity).centerId);
      if (!ce) continue;
      const pts = lineCircleIntersection(a, b, ce, (e as CircleEntity).radius);
      for (const p of pts) out.push(...tForPoint(a, b, p));
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const ce = findPoint(state, ae.centerId);
      const sp = findPoint(state, ae.startId);
      const fp = findPoint(state, ae.endId);
      if (!ce || !sp || !fp) continue;
      const pts = lineCircleIntersection(a, b, ce, ae.radius);
      const sa = Math.atan2(sp.y - ce.y, sp.x - ce.x);
      const ea = Math.atan2(fp.y - ce.y, fp.x - ce.x);
      for (const p of pts) {
        const angle = Math.atan2(p.y - ce.y, p.x - ce.x);
        if (angleInArcSweep(angle, sa, ea, ae.ccw)) {
          out.push(...tForPoint(a, b, p));
        }
      }
    }
  }
  return out;
}

function tForPoint(a: Pt, b: Pt, p: Pt): number[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return [];
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t > EPS && t < 1 - EPS) return [t];
  return [];
}

function trimCircle(state: SketchState, circle: CircleEntity, click: Pt): OpResult {
  const center = findPoint(state, circle.centerId);
  if (!center) return { state, error: 'Circle center missing' };
  // Find every angle where another curve crosses the circle.
  const angles = collectCircleHits(state, circle, center);
  if (angles.length === 0) {
    return { state: deletePrimitive(state, circle.id), affectedIds: [] };
  }
  if (angles.length === 1) {
    // Single crossing — can't cut into an arc segment cleanly. Delete it.
    return { state: deletePrimitive(state, circle.id), affectedIds: [] };
  }
  // Click angle.
  const clickAngle = normalizeAngle(Math.atan2(click.y - center.y, click.x - center.x));
  const sorted = angles.map(normalizeAngle).slice().sort((a, b) => a - b);
  // Find the two consecutive hits that bracket clickAngle (wrapping around).
  let prevA = sorted[sorted.length - 1] - 2 * Math.PI;
  let nextA = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] <= clickAngle + EPS) prevA = sorted[i];
    if (sorted[i] > clickAngle - EPS) { nextA = sorted[i]; break; }
  }
  if (nextA <= clickAngle) nextA = sorted[0] + 2 * Math.PI;
  // Remove the wedge between prevA and nextA (the side under the click), keep
  // the rest as an arc from nextA → prevA + 2π going CCW.
  let s = deletePrimitive(state, circle.id);
  const r = circle.radius;
  const sx = center.x + r * Math.cos(nextA);
  const sy = center.y + r * Math.sin(nextA);
  const ex = center.x + r * Math.cos(prevA + 2 * Math.PI);
  const ey = center.y + r * Math.sin(prevA + 2 * Math.PI);
  const ar = addArc(s, center.x, center.y, sx, sy, ex, ey, true);
  s = ar.state;
  return { state: s, affectedIds: [ar.id] };
}

function trimArc(state: SketchState, arc: ArcEntity, click: Pt): OpResult {
  const center = findPoint(state, arc.centerId);
  const sp = findPoint(state, arc.startId);
  const ep = findPoint(state, arc.endId);
  if (!center || !sp || !ep) return { state, error: 'Arc endpoints missing' };

  const startA = Math.atan2(sp.y - center.y, sp.x - center.x);
  const endA = Math.atan2(ep.y - center.y, ep.x - center.x);
  const hits = collectArcHits(state, arc, center, startA, endA);
  if (hits.length === 0) {
    return { state: deletePrimitive(state, arc.id), affectedIds: [] };
  }
  // Express click + hits as sweep-offset from startA in the arc's CCW dir.
  const offset = (a: number) => arcOffset(startA, a, arc.ccw);
  const sweep = arcOffset(startA, endA, arc.ccw);
  const clickAngle = Math.atan2(click.y - center.y, click.x - center.x);
  const clickOff = offset(clickAngle);
  if (clickOff < -EPS || clickOff > sweep + EPS) {
    return { state, error: 'Click is outside arc sweep' };
  }
  const offs = hits.map(h => offset(h)).filter(h => h > EPS && h < sweep - EPS);

  let leftOff: number | null = null;
  let rightOff: number | null = null;
  for (const o of offs) {
    if (o < clickOff - EPS) {
      if (leftOff === null || o > leftOff) leftOff = o;
    } else if (o > clickOff + EPS) {
      if (rightOff === null || o < rightOff) rightOff = o;
    }
  }
  // Keep segments [0, leftOff] and [rightOff, sweep] as separate arcs.
  const keep: Array<[number, number]> = [];
  if (leftOff !== null && rightOff !== null) {
    keep.push([0, leftOff], [rightOff, sweep]);
  } else if (leftOff !== null) {
    keep.push([0, leftOff]);
  } else if (rightOff !== null) {
    keep.push([rightOff, sweep]);
  } else {
    // No bounding hits inside the arc → drop the whole thing.
    return { state: deletePrimitive(state, arc.id), affectedIds: [] };
  }

  let s = deletePrimitive(state, arc.id);
  const newIds: string[] = [];
  for (const [o0, o1] of keep) {
    if (Math.abs(o1 - o0) < EPS) continue;
    const a0 = startA + (arc.ccw ? o0 : -o0);
    const a1 = startA + (arc.ccw ? o1 : -o1);
    const p0 = { x: center.x + arc.radius * Math.cos(a0), y: center.y + arc.radius * Math.sin(a0) };
    const p1 = { x: center.x + arc.radius * Math.cos(a1), y: center.y + arc.radius * Math.sin(a1) };
    const ar = addArc(s, center.x, center.y, p0.x, p0.y, p1.x, p1.y, arc.ccw);
    s = ar.state;
    newIds.push(ar.id);
  }
  return { state: s, affectedIds: newIds };
}

function collectCircleHits(state: SketchState, circle: CircleEntity, center: Pt): number[] {
  const out: number[] = [];
  for (const e of state.entities) {
    if (e.id === circle.id || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const pts = lineCircleIntersection(a, b, center, circle.radius);
      for (const p of pts) {
        const t = lineParam(a, b, p);
        if (t !== null && t > EPS && t < 1 - EPS) {
          out.push(Math.atan2(p.y - center.y, p.x - center.x));
        }
      }
    } else if (e.kind === 'circle') {
      const oc = findPoint(state, (e as CircleEntity).centerId);
      if (!oc) continue;
      const pts = circleCircleIntersection(center, circle.radius, oc, (e as CircleEntity).radius);
      for (const p of pts) out.push(Math.atan2(p.y - center.y, p.x - center.x));
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const oc = findPoint(state, ae.centerId);
      const osp = findPoint(state, ae.startId);
      const oep = findPoint(state, ae.endId);
      if (!oc || !osp || !oep) continue;
      const pts = circleCircleIntersection(center, circle.radius, oc, ae.radius);
      const sa = Math.atan2(osp.y - oc.y, osp.x - oc.x);
      const ea = Math.atan2(oep.y - oc.y, oep.x - oc.x);
      for (const p of pts) {
        const ang = Math.atan2(p.y - oc.y, p.x - oc.x);
        if (angleInArcSweep(ang, sa, ea, ae.ccw)) {
          out.push(Math.atan2(p.y - center.y, p.x - center.x));
        }
      }
    }
  }
  return out;
}

function collectArcHits(
  state: SketchState, arc: ArcEntity, center: Pt, startA: number, endA: number,
): number[] {
  const out: number[] = [];
  for (const e of state.entities) {
    if (e.id === arc.id || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const pts = lineCircleIntersection(a, b, center, arc.radius);
      for (const p of pts) {
        const t = lineParam(a, b, p);
        if (t === null || t <= EPS || t >= 1 - EPS) continue;
        const ang = Math.atan2(p.y - center.y, p.x - center.x);
        if (angleInArcSweep(ang, startA, endA, arc.ccw)) out.push(ang);
      }
    } else if (e.kind === 'circle') {
      const oc = findPoint(state, (e as CircleEntity).centerId);
      if (!oc) continue;
      const pts = circleCircleIntersection(center, arc.radius, oc, (e as CircleEntity).radius);
      for (const p of pts) {
        const ang = Math.atan2(p.y - center.y, p.x - center.x);
        if (angleInArcSweep(ang, startA, endA, arc.ccw)) out.push(ang);
      }
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const oc = findPoint(state, ae.centerId);
      const osp = findPoint(state, ae.startId);
      const oep = findPoint(state, ae.endId);
      if (!oc || !osp || !oep) continue;
      const pts = circleCircleIntersection(center, arc.radius, oc, ae.radius);
      const sa2 = Math.atan2(osp.y - oc.y, osp.x - oc.x);
      const ea2 = Math.atan2(oep.y - oc.y, oep.x - oc.x);
      for (const p of pts) {
        const angSelf = Math.atan2(p.y - center.y, p.x - center.x);
        const angOther = Math.atan2(p.y - oc.y, p.x - oc.x);
        if (angleInArcSweep(angSelf, startA, endA, arc.ccw) &&
            angleInArcSweep(angOther, sa2, ea2, ae.ccw)) {
          out.push(angSelf);
        }
      }
    }
  }
  return out;
}

function lineParam(a: Pt, b: Pt, p: Pt): number | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return null;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

/** CCW offset from `from` to `to` in [0, 2π). */
function normalizeAngle(a: number): number {
  const TAU = Math.PI * 2;
  const m = a % TAU;
  return m < 0 ? m + TAU : m;
}

/** Sweep offset in the arc's chosen direction (CCW or CW). */
function arcOffset(startA: number, a: number, ccw: boolean): number {
  const TAU = Math.PI * 2;
  let off = ccw ? a - startA : startA - a;
  while (off < 0) off += TAU;
  while (off >= TAU) off -= TAU;
  return off;
}

// ────────────────────────────────────────────────────────────────────────────
// Extend
// ────────────────────────────────────────────────────────────────────────────
// SolidWorks behavior: the user picks a line and the tool extends the
// nearest endpoint to the closest "boundary" (any other non-construction
// curve hit along the line's direction beyond the original endpoint). The
// "nearest endpoint" is decided by which end of the line the cursor is
// nearer to — same convention as SolidWorks.

/** Extend `line` from the endpoint nearest to `clickPoint` to the closest
 * boundary curve along the line's direction. */
export function extendLine(state: SketchState, lineId: string, clickPoint: Pt): OpResult {
  const line = findEntity<LineEntity>(state, lineId);
  if (!line || line.kind !== 'line') return { state, error: 'Not a line' };
  if (line.construction) return { state, error: 'Cannot extend construction geometry' };
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return { state, error: 'Line endpoints missing' };

  // Pick the endpoint to extend: whichever is closer to the click.
  const da = (clickPoint.x - a.x) ** 2 + (clickPoint.y - a.y) ** 2;
  const db = (clickPoint.x - b.x) ** 2 + (clickPoint.y - b.y) ** 2;
  const extendStart = da < db;
  // Each candidate carries the t-parameter on (a→b) PLUS the boundary entity
  // it came from. We need the entity later to add a coincident constraint
  // against the curve when the boundary is a circle/arc/ellipse.
  const candidates: Array<{ t: number; entity: SketchEntity }> = [];
  for (const e of state.entities) {
    if (e.id === line.id || e.construction) continue;
    if (e.kind === 'line') {
      const oa = findPoint(state, e.startId);
      const ob = findPoint(state, e.endId);
      if (!oa || !ob) continue;
      const r = lineLineIntersection(a, b, oa, ob);
      if (!r) continue;
      if (r.t2 < -EPS || r.t2 > 1 + EPS) continue;  // Boundary must hit within its own segment.
      if (extendStart && r.t1 < -EPS) candidates.push({ t: r.t1, entity: e });
      if (!extendStart && r.t1 > 1 + EPS) candidates.push({ t: r.t1, entity: e });
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      const ce = findPoint(state, (e as CircleEntity | ArcEntity).centerId);
      if (!ce) continue;
      const radius = (e as CircleEntity | ArcEntity).radius;
      const pts = lineCircleIntersection(a, b, ce, radius);
      let validPts = pts;
      if (e.kind === 'arc') {
        const ae = e as ArcEntity;
        const sp = findPoint(state, ae.startId);
        const ep = findPoint(state, ae.endId);
        if (!sp || !ep) continue;
        const sa = Math.atan2(sp.y - ce.y, sp.x - ce.x);
        const ea = Math.atan2(ep.y - ce.y, ep.x - ce.x);
        validPts = pts.filter(p => {
          const ang = Math.atan2(p.y - ce.y, p.x - ce.x);
          return angleInArcSweep(ang, sa, ea, ae.ccw);
        });
      }
      for (const p of validPts) {
        const t = lineParam(a, b, p);
        if (t === null) continue;
        if (extendStart && t < -EPS) candidates.push({ t, entity: e });
        if (!extendStart && t > 1 + EPS) candidates.push({ t, entity: e });
      }
    }
  }
  if (candidates.length === 0) return { state, error: 'No boundary to extend to' };

  // Pick the boundary closest to the existing endpoint (the smallest absolute
  // jump). Extending start → maximum t (closest to 0 from below). Extending
  // end → minimum t (closest to 1 from above).
  const chosen = extendStart
    ? candidates.reduce((acc, x) => x.t > acc.t ? x : acc)
    : candidates.reduce((acc, x) => x.t < acc.t ? x : acc);
  const targetT = chosen.t;
  const boundaryEntity = chosen.entity;
  const newPoint = {
    x: a.x + (b.x - a.x) * targetT,
    y: a.y + (b.y - a.y) * targetT,
  };
  const oldEndpointId = extendStart ? line.startId : line.endId;
  // Two paths depending on whether the endpoint is shared with anything else:
  //  - shared (e.g. rectangle corner): create a NEW point at the target and
  //    rebind THIS line's endpoint to it. The old point stays put so the
  //    other entities anchored there don't drift.
  //  - exclusive: just move the existing point. Avoids leaving an orphan.
  // In BOTH paths we add a coincident constraint pinning the extended
  // endpoint to the boundary entity — line, curve, whatever — so the
  // extend relationship survives future edits. The unified `coincident`
  // type dispatches on target kind at solve time.
  if (pointIsSharedBeyond(state, oldEndpointId, line.id)) {
    const np = addPoint(state, newPoint.x, newPoint.y);
    let s: SketchState = {
      ...np.state,
      entities: np.state.entities.map(en => {
        if (en.id !== line.id || en.kind !== 'line') return en;
        return {
          ...en,
          startId: extendStart ? np.id : en.startId,
          endId:   extendStart ? en.endId : np.id,
        };
      }),
    };
    // 1) The old corner is collinear with the extended line — keeps it
    //    on the line through future edits.
    s = addConstraint(s, 'coincident', [oldEndpointId, line.id]).state;
    // 2) The new endpoint sits on the boundary entity — preserves the
    //    "extended TO this thing" semantic.
    s = addConstraint(s, 'coincident', [np.id, boundaryEntity.id]).state;
    return { state: s, affectedIds: [line.id] };
  }
  // Exclusive endpoint — just move it in place, then bind it to the
  // boundary so it stays there through future edits.
  let s: SketchState = {
    ...state,
    entities: state.entities.map(en =>
      en.id === oldEndpointId && en.kind === 'point'
        ? { ...en, x: newPoint.x, y: newPoint.y }
        : en,
    ),
  };
  s = addConstraint(s, 'coincident', [oldEndpointId, boundaryEntity.id]).state;
  return { state: s, affectedIds: [line.id] };
}

/** True when `pointId` is referenced by any entity OTHER than
 * `exceptEntityId`. Used by Extend to decide whether moving the point
 * would deform adjacent geometry; if so, the caller creates a fresh point
 * and rebinds just the extended line. */
function pointIsSharedBeyond(state: SketchState, pointId: string, exceptEntityId: string): boolean {
  for (const e of state.entities) {
    if (e.id === exceptEntityId) continue;
    switch (e.kind) {
      case 'line':
        if (e.startId === pointId || e.endId === pointId) return true;
        break;
      case 'circle':
        if (e.centerId === pointId) return true;
        break;
      case 'arc':
        if (e.centerId === pointId || e.startId === pointId || e.endId === pointId) return true;
        break;
      case 'ellipse':
        if (e.centerId === pointId || e.majorAxisEndId === pointId) return true;
        break;
      case 'spline':
        if (e.controlPointIds.includes(pointId)) return true;
        break;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Split
// ────────────────────────────────────────────────────────────────────────────
// Split a line at a click point: the original line is replaced by two
// shorter lines sharing a new midpoint. Useful for inserting a constraint
// at an arbitrary location.

export function splitLineAt(state: SketchState, lineId: string, clickPoint: Pt): OpResult {
  const line = findEntity<LineEntity>(state, lineId);
  if (!line || line.kind !== 'line') return { state, error: 'Not a line' };
  if (line.construction) return { state, error: 'Cannot split construction geometry' };
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return { state, error: 'Line endpoints missing' };
  const proj = projectOntoSegment(a, b, clickPoint);
  if (proj.t < EPS || proj.t > 1 - EPS) {
    return { state, error: 'Cannot split at an endpoint' };
  }
  let s = deletePrimitive(state, line.id);
  const np = addPoint(s, proj.p.x, proj.p.y); s = np.state;
  // Re-introduce the two endpoints (deletePrimitive removed them too via the
  // cascade — same lifecycle as the line's own deletion).
  const newA = addPoint(s, a.x, a.y); s = newA.state;
  const newB = addPoint(s, b.x, b.y); s = newB.state;
  const l1 = addLine(s, newA.id, np.id); s = l1.state;
  const l2 = addLine(s, np.id, newB.id); s = l2.state;
  return { state: s, affectedIds: [l1.id, l2.id] };
}

// ────────────────────────────────────────────────────────────────────────────
// Mirror
// ────────────────────────────────────────────────────────────────────────────
// Mirror a set of entities across a chosen line. Lines/arcs/circles each
// produce a reflected counterpart, AND the function emits matching
// `symmetric` constraints (per point pair across the axis) plus `equal`
// constraints (per circle/arc pair, so radii stay locked). This mirrors
// SolidWorks's "Mirror Entities" default — drag the original, watch the
// mirror follow. Caller can remove constraints afterwards if they want a
// decoupled copy.

export function mirrorEntities(
  state: SketchState, entityIds: string[], axisLineId: string,
): OpResult {
  const axis = findEntity<LineEntity>(state, axisLineId);
  if (!axis || axis.kind !== 'line') return { state, error: 'Axis must be a line' };
  const a = findPoint(state, axis.startId);
  const b = findPoint(state, axis.endId);
  if (!a || !b) return { state, error: 'Axis endpoints missing' };

  let s = state;
  const created: string[] = [];
  const seen = new Set<string>();
  // Point pairings drive the symmetric constraints. Each entry is
  // (originalPointId, mirroredPointId) — both ids live in `s` after the
  // mirror entities have been added.
  const pointPairs: Array<[string, string]> = [];
  // Curve pairings drive the equal constraints — necessary because the
  // radius of a mirrored circle/arc is a free parameter without an equal
  // link, even though symmetric point constraints fix the center positions.
  const equalPairs: Array<[string, string]> = [];

  for (const id of entityIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = findEntity(state, id);
    if (!e || e.id === axisLineId) continue;
    if (e.kind === 'line') {
      const sa = findPoint(state, e.startId);
      const sb = findPoint(state, e.endId);
      if (!sa || !sb) continue;
      const ra = reflectAcrossLine(sa, a, b);
      const rb = reflectAcrossLine(sb, a, b);
      const pa = addPoint(s, ra.x, ra.y); s = pa.state;
      const pb = addPoint(s, rb.x, rb.y); s = pb.state;
      const ln = addLine(s, pa.id, pb.id); s = ln.state;
      created.push(ln.id);
      pointPairs.push([e.startId, pa.id], [e.endId, pb.id]);
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, e.centerId);
      if (!ce) continue;
      const rc = reflectAcrossLine(ce, a, b);
      const cr = addCircle(s, rc.x, rc.y, e.radius); s = cr.state;
      created.push(cr.id);
      const newCircle = findEntity<CircleEntity>(s, cr.id);
      if (newCircle) pointPairs.push([e.centerId, newCircle.centerId]);
      equalPairs.push([e.id, cr.id]);
    } else if (e.kind === 'arc') {
      const ce = findPoint(state, e.centerId);
      const sp = findPoint(state, e.startId);
      const ep = findPoint(state, e.endId);
      if (!ce || !sp || !ep) continue;
      const rc = reflectAcrossLine(ce, a, b);
      const rs = reflectAcrossLine(sp, a, b);
      const re = reflectAcrossLine(ep, a, b);
      // Reflection reverses orientation; flip ccw.
      const ar = addArc(s, rc.x, rc.y, rs.x, rs.y, re.x, re.y, !e.ccw); s = ar.state;
      created.push(ar.id);
      const newArc = findEntity<ArcEntity>(s, ar.id);
      if (newArc) {
        pointPairs.push(
          [e.centerId, newArc.centerId],
          [e.startId, newArc.startId],
          [e.endId, newArc.endId],
        );
      }
      equalPairs.push([e.id, ar.id]);
    } else if (e.kind === 'point') {
      const rp = reflectAcrossLine(e, a, b);
      const np = addPoint(s, rp.x, rp.y); s = np.state;
      created.push(np.id);
      pointPairs.push([e.id, np.id]);
    }
  }

  // Emit symmetric(origPoint, mirroredPoint, axisLine) for every pair.
  // The constraint shape `[point, point, line]` matches the
  // CONSTRAINT_SPECS predicate so the solver picks the right primitive.
  for (const [orig, mirrored] of pointPairs) {
    const r = addConstraint(s, 'symmetric', [orig, mirrored, axisLineId]);
    s = r.state;
  }
  // Equal links the radii (circles) or radii+swept lengths (arcs). Lines
  // don't need equal — their lengths follow automatically from the
  // symmetric endpoint pairs.
  for (const [orig, mirrored] of equalPairs) {
    const r = addConstraint(s, 'equal', [orig, mirrored]);
    s = r.state;
  }

  return { state: s, affectedIds: created };
}

// ────────────────────────────────────────────────────────────────────────────
// Offset
// ────────────────────────────────────────────────────────────────────────────
// Offset a curve by a signed distance perpendicular to its direction. For
// lines the sign comes from which side of the line `sidePoint` lies on; the
// offset distance is the magnitude. For circles, `sidePoint` outside the
// circle picks "outward" (radius grows); inside picks "inward" (radius
// shrinks but not below zero).

export function offsetCurve(
  state: SketchState, entityId: string, distance: number, sidePoint: Pt,
): OpResult {
  const e = findEntity(state, entityId);
  if (!e) return { state, error: 'Entity not found' };
  if (e.construction) return { state, error: 'Cannot offset construction geometry' };
  if (distance <= EPS) return { state, error: 'Offset distance must be positive' };
  switch (e.kind) {
    case 'line': {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) return { state, error: 'Line endpoints missing' };
      // Which side of the line is sidePoint on? Sign of the 2D cross product.
      const dx = b.x - a.x, dy = b.y - a.y;
      const cross = dx * (sidePoint.y - a.y) - dy * (sidePoint.x - a.x);
      const sign = cross >= 0 ? +1 : -1;
      const len = Math.hypot(dx, dy);
      if (len < EPS) return { state, error: 'Line is degenerate' };
      const nx = -dy / len * sign, ny = dx / len * sign;
      const off = (p: Pt) => ({ x: p.x + nx * distance, y: p.y + ny * distance });
      const ra = off(a), rb = off(b);
      let s = state;
      const pa = addPoint(s, ra.x, ra.y); s = pa.state;
      const pb = addPoint(s, rb.x, rb.y); s = pb.state;
      const ln = addLine(s, pa.id, pb.id); s = ln.state;
      return { state: s, affectedIds: [ln.id] };
    }
    case 'circle': {
      const ce = findPoint(state, e.centerId);
      if (!ce) return { state, error: 'Circle center missing' };
      const dToCenter = Math.hypot(sidePoint.x - ce.x, sidePoint.y - ce.y);
      const outward = dToCenter > e.radius;
      const newR = outward ? e.radius + distance : e.radius - distance;
      if (newR <= EPS) return { state, error: 'Offset would collapse circle' };
      const r = addCircle(state, ce.x, ce.y, newR);
      return { state: r.state, affectedIds: [r.id] };
    }
    case 'arc': {
      const ce = findPoint(state, e.centerId);
      const sp = findPoint(state, e.startId);
      const ep = findPoint(state, e.endId);
      if (!ce || !sp || !ep) return { state, error: 'Arc endpoints missing' };
      const dToCenter = Math.hypot(sidePoint.x - ce.x, sidePoint.y - ce.y);
      const outward = dToCenter > e.radius;
      const newR = outward ? e.radius + distance : e.radius - distance;
      if (newR <= EPS) return { state, error: 'Offset would collapse arc' };
      const scale = newR / e.radius;
      const ns = { x: ce.x + (sp.x - ce.x) * scale, y: ce.y + (sp.y - ce.y) * scale };
      const ne = { x: ce.x + (ep.x - ce.x) * scale, y: ce.y + (ep.y - ce.y) * scale };
      const r = addArc(state, ce.x, ce.y, ns.x, ns.y, ne.x, ne.y, e.ccw);
      return { state: r.state, affectedIds: [r.id] };
    }
    default:
      return { state, error: `Offset not supported for ${e.kind}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fillet (sketch)
// ────────────────────────────────────────────────────────────────────────────
// Round the corner between two non-parallel lines with an arc of radius R.
//
// Algorithm:
//   1. V = intersection of the infinite lines.
//   2. u1, u2 = unit vectors from V toward each line's "far" endpoint.
//   3. half-angle α between u1 and u2.
//   4. tangent distance d = R / tan(α);  arc-center distance D = R / sin(α).
//   5. Tangent points T1 = V + u1·d, T2 = V + u2·d.
//   6. Arc center C = V + bisector·D, where bisector = normalize(u1 + u2).
//   7. ccw flag picked so the arc sweep takes the SHORT path C→T1→T2.
//
// The "near V" endpoints of each line get rebound to fresh tangent points,
// leaving the original corner point alone — it stays attached to anything
// else that referenced it (third lines, dim constraints, etc.). Tangent
// constraints are added between each line and the new arc so the fillet
// holds together through future edits.

export interface FilletChamferOptions {
  /** When true, the trimmed-back portion of each original line is kept as
   * a dashed construction line — so the original full geometry stays
   * visible as reference (a SolidWorks-style "preserve construction"
   * affordance). Only applies when the near-V endpoint is at V (i.e., the
   * lines share a real corner). */
  keepRemovedAsConstruction?: boolean;
}

export type ChamferMode =
  | { kind: 'equal-distance'; distance: number }
  | { kind: 'distance-distance'; distance1: number; distance2: number }
  | { kind: 'distance-angle'; distance: number; angleRad: number; primary: 1 | 2 };

/** Result of the chamfer-geometry computation — the corner intersection V,
 * the two tangent / cut points T1 and T2, and the near-V endpoint ids of
 * the source lines (so the caller can rebind them). Returned by the
 * extracted helpers so preview overlays and the actual commit can share
 * the math without re-implementing.
 *
 * `line1Id` / `line2Id` are the IDs of the source lines AFTER any internal
 * reordering (e.g., the distance-distance more-vertical-first swap). T1
 * lies on `line1Id` and T2 on `line2Id`. Callers that rebind line endpoints
 * (chamferLines/filletLines) MUST use these IDs — using the originally-
 * passed-in IDs would rebind the wrong lines whenever a swap occurred. */
export interface ChamferGeometry {
  V: Pt;
  T1: Pt;
  T2: Pt;
  a_near_id: string;
  b_near_id: string;
  line1Id: string;
  line2Id: string;
}

/** Fillet geometry — chamfer's superset, with the arc center C and CCW
 * direction tacked on. */
export interface FilletGeometry extends ChamferGeometry {
  C: Pt;
  ccw: boolean;
  radius: number;
}

/** Pure geometry for a fillet between two lines at radius `radius`.
 * Returns null when the configuration is invalid (parallel lines,
 * collinear, radius too large, degenerate). */
export function computeFilletGeometry(
  state: SketchState, lineId1: string, lineId2: string, radius: number,
): FilletGeometry | null {
  const l1 = findEntity<LineEntity>(state, lineId1);
  const l2 = findEntity<LineEntity>(state, lineId2);
  if (!l1 || l1.kind !== 'line' || !l2 || l2.kind !== 'line') return null;
  if (l1.id === l2.id || !isFinite(radius) || radius <= EPS) return null;
  const a1 = findPoint(state, l1.startId), a2 = findPoint(state, l1.endId);
  const b1 = findPoint(state, l2.startId), b2 = findPoint(state, l2.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
  const isect = lineLineIntersection(a1, a2, b1, b2);
  if (!isect) return null;
  const V = isect.p;

  const { u1, u2, u1len, u2len, a_far, b_far, a_near_id, b_near_id } =
    cornerVectors(l1, l2, a1, a2, b1, b2, V);
  if (!u1 || !u2) return null;
  void a_far; void b_far;
  const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
  const twoAlpha = Math.acos(dot);
  if (twoAlpha < 1e-4 || Math.PI - twoAlpha < 1e-4) return null;
  const alpha = twoAlpha / 2;
  const d = radius / Math.tan(alpha);
  const D = radius / Math.sin(alpha);
  if (d > u1len - EPS || d > u2len - EPS) return null;
  const T1 = { x: V.x + u1.x * d, y: V.y + u1.y * d };
  const T2 = { x: V.x + u2.x * d, y: V.y + u2.y * d };
  const bx = u1.x + u2.x, by = u1.y + u2.y;
  const blen = Math.hypot(bx, by);
  if (blen < EPS) return null;
  const C = { x: V.x + (bx / blen) * D, y: V.y + (by / blen) * D };
  const c1x = T1.x - C.x, c1y = T1.y - C.y;
  const c2x = T2.x - C.x, c2y = T2.y - C.y;
  const ccw = (c1x * c2y - c1y * c2x) > 0;
  return { V, T1, T2, C, ccw, radius, a_near_id, b_near_id, line1Id: l1.id, line2Id: l2.id };
}

/** Pure geometry for a chamfer at a corner. Supports three modes:
 *   - equal-distance: same leg length on both sides.
 *   - distance-distance: independent leg lengths.
 *   - distance-angle: one leg + a target angle measured at the leg's
 *     tangent point from the reference line's "into-corner" direction.
 * Returns null on degenerate / invalid configurations. */
export function computeChamferGeometry(
  state: SketchState, lineId1: string, lineId2: string, mode: ChamferMode,
): ChamferGeometry | null {
  let l1 = findEntity<LineEntity>(state, lineId1);
  let l2 = findEntity<LineEntity>(state, lineId2);
  if (!l1 || l1.kind !== 'line' || !l2 || l2.kind !== 'line') return null;
  if (l1.id === l2.id) return null;
  // For distance-distance mode: ensure line1 is the MORE-vertical of the
  // two so mode.distance1 (= sidebar's "Vertical" input) corresponds to
  // the leg along the vertical line. Done here (not in callers) so the
  // preview overlay and the actual commit produce identical geometry.
  // For axis-aligned right-angle corners this is exact; for other angles
  // it's the closest approximation — the dim values still come from the
  // resulting cut endpoints' actual Δy / Δx.
  if (mode.kind === 'distance-distance') {
    const dir = (l: LineEntity) => {
      const a = findPoint(state, l.startId);
      const b = findPoint(state, l.endId);
      if (!a || !b) return { x: 1, y: 0 };
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    };
    if (Math.abs(dir(l1).y) < Math.abs(dir(l2).y)) {
      [l1, l2] = [l2, l1];
    }
  }
  const a1 = findPoint(state, l1.startId), a2 = findPoint(state, l1.endId);
  const b1 = findPoint(state, l2.startId), b2 = findPoint(state, l2.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
  const isect = lineLineIntersection(a1, a2, b1, b2);
  if (!isect) return null;
  const V = isect.p;
  const { u1, u2, u1len, u2len, a_near_id, b_near_id } = cornerVectors(l1, l2, a1, a2, b1, b2, V);
  if (!u1 || !u2) return null;
  const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
  if (Math.abs(dot - 1) < 1e-4 || Math.abs(dot + 1) < 1e-4) return null;

  let d1: number, d2: number;
  if (mode.kind === 'equal-distance') {
    if (!isFinite(mode.distance) || mode.distance <= EPS) return null;
    d1 = d2 = mode.distance;
  } else if (mode.kind === 'distance-distance') {
    if (!isFinite(mode.distance1) || mode.distance1 <= EPS) return null;
    if (!isFinite(mode.distance2) || mode.distance2 <= EPS) return null;
    d1 = mode.distance1; d2 = mode.distance2;
  } else {
    // distance-angle: solve for the cut line's intersection with the
    // non-primary line. The cut leaves T1 at angle `angleRad` from the
    // "into-corner" direction (-u_primary). Try both rotation senses;
    // pick the one that lands the intersection ahead of V on the other
    // line.
    if (!isFinite(mode.distance) || mode.distance <= EPS) return null;
    if (!isFinite(mode.angleRad) || mode.angleRad <= EPS || mode.angleRad >= Math.PI - EPS) return null;
    const primaryU = mode.primary === 1 ? u1 : u2;
    const otherU   = mode.primary === 1 ? u2 : u1;
    const primaryLen = mode.primary === 1 ? u1len : u2len;
    const otherLen   = mode.primary === 1 ? u2len : u1len;
    const dPrimary = mode.distance;
    if (dPrimary > primaryLen - EPS) return null;
    const Tprim = { x: V.x + primaryU.x * dPrimary, y: V.y + primaryU.y * dPrimary };
    const intoCorner = { x: -primaryU.x, y: -primaryU.y };
    const sIntersect = (sign: 1 | -1): number | null => {
      const cs = Math.cos(sign * mode.angleRad);
      const sn = Math.sin(sign * mode.angleRad);
      const uCut = { x: intoCorner.x * cs - intoCorner.y * sn, y: intoCorner.x * sn + intoCorner.y * cs };
      const det = otherU.x * uCut.y - otherU.y * uCut.x;
      if (Math.abs(det) < EPS) return null;
      const vx = V.x - Tprim.x, vy = V.y - Tprim.y;
      const tCut = (otherU.x * vy - otherU.y * vx) / det;
      const sOther = (uCut.y * vx - uCut.x * vy) / det;
      if (tCut <= EPS || sOther <= EPS) return null;
      return sOther;
    };
    const sPos = sIntersect(+1);
    const sNeg = sIntersect(-1);
    const sChosen = sPos ?? sNeg;
    if (sChosen === null) return null;
    if (sChosen > otherLen - EPS) return null;
    if (mode.primary === 1) { d1 = dPrimary; d2 = sChosen; }
    else                    { d2 = dPrimary; d1 = sChosen; }
  }

  if (d1 > u1len - EPS || d2 > u2len - EPS) return null;
  const T1 = { x: V.x + u1.x * d1, y: V.y + u1.y * d1 };
  const T2 = { x: V.x + u2.x * d2, y: V.y + u2.y * d2 };
  return { V, T1, T2, a_near_id, b_near_id, line1Id: l1.id, line2Id: l2.id };
}

/** Resolve the two-line corner: V is the intersection (caller passes in);
 * for each line, identify which endpoint is FAR from V (kept) and which is
 * NEAR V (to be trimmed). Returns the unit "outward" directions u1, u2 and
 * the near-endpoint ids. Used by both Fillet and Chamfer. */
function cornerVectors(
  l1: LineEntity, l2: LineEntity,
  a1: PointEntity, a2: PointEntity, b1: PointEntity, b2: PointEntity,
  V: Pt,
): {
  u1: { x: number; y: number } | null;
  u2: { x: number; y: number } | null;
  u1len: number; u2len: number;
  a_far: PointEntity; b_far: PointEntity;
  a_near_id: string; b_near_id: string;
} {
  const dA1 = Math.hypot(a1.x - V.x, a1.y - V.y);
  const dA2 = Math.hypot(a2.x - V.x, a2.y - V.y);
  const a_far  = dA1 > dA2 ? a1 : a2;
  const a_near_id = dA1 > dA2 ? l1.endId : l1.startId;
  const dB1 = Math.hypot(b1.x - V.x, b1.y - V.y);
  const dB2 = Math.hypot(b2.x - V.x, b2.y - V.y);
  const b_far  = dB1 > dB2 ? b1 : b2;
  const b_near_id = dB1 > dB2 ? l2.endId : l2.startId;
  const u1len = Math.hypot(a_far.x - V.x, a_far.y - V.y);
  const u2len = Math.hypot(b_far.x - V.x, b_far.y - V.y);
  if (u1len < EPS || u2len < EPS) {
    return { u1: null, u2: null, u1len, u2len, a_far, b_far, a_near_id, b_near_id };
  }
  return {
    u1: { x: (a_far.x - V.x) / u1len, y: (a_far.y - V.y) / u1len },
    u2: { x: (b_far.x - V.x) / u2len, y: (b_far.y - V.y) / u2len },
    u1len, u2len, a_far, b_far, a_near_id, b_near_id,
  };
}

export function filletLines(
  state: SketchState, lineId1: string, lineId2: string, radius: number,
  options: FilletChamferOptions = {},
): OpResult {
  const l1 = findEntity<LineEntity>(state, lineId1);
  const l2 = findEntity<LineEntity>(state, lineId2);
  if (!l1 || l1.kind !== 'line') return { state, error: 'First entity must be a line' };
  if (!l2 || l2.kind !== 'line') return { state, error: 'Second entity must be a line' };
  if (l1.construction || l2.construction) return { state, error: 'Cannot fillet construction geometry' };
  const geom = computeFilletGeometry(state, lineId1, lineId2, radius);
  if (!geom) return { state, error: 'Fillet not applicable (parallel, collinear, or radius too large)' };
  const { V, T1, T2, C, ccw, a_near_id, b_near_id } = geom;

  // Build the new geometry.
  let s = state;
  const pt1 = addPoint(s, T1.x, T1.y); s = pt1.state;
  const pt2 = addPoint(s, T2.x, T2.y); s = pt2.state;
  const pc  = addPoint(s, C.x,  C.y);  s = pc.state;

  // Rebind L1's "near V" endpoint → T1; L2's → T2. We leave the old corner
  // point alone (it may be referenced by other entities — third line at the
  // corner, dim constraint, etc.).
  s = {
    ...s,
    entities: s.entities.map(en => {
      if (en.kind !== 'line') return en;
      if (en.id === l1.id) {
        return {
          ...en,
          startId: en.startId === a_near_id ? pt1.id : en.startId,
          endId:   en.endId   === a_near_id ? pt1.id : en.endId,
        };
      }
      if (en.id === l2.id) {
        return {
          ...en,
          startId: en.startId === b_near_id ? pt2.id : en.startId,
          endId:   en.endId   === b_near_id ? pt2.id : en.endId,
        };
      }
      return en;
    }),
  };

  const arc = addArcByPoints(s, pc.id, pt1.id, pt2.id, ccw); s = arc.state;

  // Tangent constraints lock the line ↔ arc relationship through future
  // edits. Without these, dragging a line would let the arc drift off
  // tangency.
  s = addConstraint(s, 'tangent', [l1.id, arc.id]).state;
  s = addConstraint(s, 'tangent', [l2.id, arc.id]).state;

  const constructionLineIds: string[] = [];
  if (options.keepRemovedAsConstruction) {
    const r1 = addTrimConstruction(s, pt1.id, a_near_id, l1.id, V);
    s = r1.state;
    if (r1.lineId) constructionLineIds.push(r1.lineId);
    const r2 = addTrimConstruction(s, pt2.id, b_near_id, l2.id, V);
    s = r2.state;
    if (r2.lineId) constructionLineIds.push(r2.lineId);
  }

  const result: OpResult = { state: s, affectedIds: [l1.id, l2.id, arc.id] };
  if (constructionLineIds.length > 0) result.constructionLineIds = constructionLineIds;
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Chamfer (sketch)
// ────────────────────────────────────────────────────────────────────────────
// Like Fillet, but the rounded arc is replaced with a straight cut. Same
// gesture, same near/far endpoint logic — the algorithm only differs at
// the end: instead of building an arc tangent to both lines, we build a
// single line connecting the two tangent points.
//
// First version is "equal-distance" only: the same `distance` from the
// corner is used along each leg. Distance-distance and distance-angle
// variants can layer on later if anyone needs them.

export function chamferLines(
  state: SketchState, lineId1: string, lineId2: string,
  modeOrDistance: ChamferMode | number,
  options: FilletChamferOptions = {},
): OpResult {
  const l1 = findEntity<LineEntity>(state, lineId1);
  const l2 = findEntity<LineEntity>(state, lineId2);
  if (!l1 || l1.kind !== 'line') return { state, error: 'First entity must be a line' };
  if (!l2 || l2.kind !== 'line') return { state, error: 'Second entity must be a line' };
  if (l1.construction || l2.construction) return { state, error: 'Cannot chamfer construction geometry' };
  // Backwards-compat: a bare number was the old signature for equal-distance.
  const mode: ChamferMode = typeof modeOrDistance === 'number'
    ? { kind: 'equal-distance', distance: modeOrDistance }
    : modeOrDistance;
  const geom = computeChamferGeometry(state, lineId1, lineId2, mode);
  if (!geom) return { state, error: 'Chamfer not applicable (parallel, collinear, or distance too large)' };
  // Use the line IDs from geom (post any internal swap) — T1 lies on
  // line1Id and T2 on line2Id, so rebinding must target those.
  const { V, T1, T2, a_near_id, b_near_id, line1Id, line2Id } = geom;

  let s = state;
  const pt1 = addPoint(s, T1.x, T1.y); s = pt1.state;
  const pt2 = addPoint(s, T2.x, T2.y); s = pt2.state;

  s = {
    ...s,
    entities: s.entities.map(en => {
      if (en.kind !== 'line') return en;
      if (en.id === line1Id) {
        return {
          ...en,
          startId: en.startId === a_near_id ? pt1.id : en.startId,
          endId:   en.endId   === a_near_id ? pt1.id : en.endId,
        };
      }
      if (en.id === line2Id) {
        return {
          ...en,
          startId: en.startId === b_near_id ? pt2.id : en.startId,
          endId:   en.endId   === b_near_id ? pt2.id : en.endId,
        };
      }
      return en;
    }),
  };

  const cutLine = addLine(s, pt1.id, pt2.id);
  s = cutLine.state;

  // Track the IDs of any construction lines we add so callers can chain
  // them with equal-length constraints across a multi-corner chamfer.
  const constructionLineIds: string[] = [];
  if (options.keepRemovedAsConstruction) {
    const r1 = addTrimConstruction(s, pt1.id, a_near_id, line1Id, V);
    s = r1.state;
    if (r1.lineId) constructionLineIds.push(r1.lineId);
    const r2 = addTrimConstruction(s, pt2.id, b_near_id, line2Id, V);
    s = r2.state;
    if (r2.lineId) constructionLineIds.push(r2.lineId);
  }

  const result: OpResult = { state: s, affectedIds: [line1Id, line2Id, cutLine.id] };
  if (constructionLineIds.length > 0) result.constructionLineIds = constructionLineIds;
  return result;
}

/** Add a dashed construction line between `tangentId` and `nearId` IF the
 * `near` point is at V — i.e., the original line ended at the corner.
 * Skipped for the "lines don't share a real corner" case (extending lines
 * to a virtual intersection), where there's no meaningful trimmed portion
 * along the existing line. The new construction line gets `construction:
 * true` directly (without the `setConstructionFlag` cascade, which would
 * also flag the supporting points as construction).
 *
 * Also emits a `collinear` constraint between the new construction line
 * and the original (now-trimmed) line so the solver keeps them on the
 * same infinite line through future edits — without this, dragging the
 * trimmed line would let the dashed extension drift away. */
function addTrimConstruction(
  state: SketchState, tangentId: string, nearId: string,
  originalLineId: string, V: Pt,
): { state: SketchState; lineId?: string } {
  const near = findPoint(state, nearId);
  if (!near) return { state };
  if (Math.hypot(near.x - V.x, near.y - V.y) > 0.5) return { state };
  const r = addLine(state, tangentId, nearId);
  let s: SketchState = {
    ...r.state,
    entities: r.state.entities.map(e =>
      e.id === r.id ? { ...e, construction: true } : e,
    ),
  };
  s = addConstraint(s, 'collinear', [originalLineId, r.id]).state;
  return { state: s, lineId: r.id };
}

// ────────────────────────────────────────────────────────────────────────────
// Transform: Move / Copy / Rotate / Scale
// ────────────────────────────────────────────────────────────────────────────
// These operate on a pre-selected entity set. Each entity contributes its
// "support points" (line endpoints / circle centers / arc points / spline
// control points / etc.) to a unique pool; the transform applies to that
// pool exactly once even when several selected entities share points.
//
// `moveEntities` and `rotateEntities` mutate existing point positions in
// place — the entity ids stay the same, so existing constraints keep
// pointing at the right targets. `copyEntities` clones everything into
// fresh entities (no constraints get cloned along; users redo any they
// want on the copy).

function supportPointIds(state: SketchState, entityIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of entityIds) {
    const e = findEntity(state, id);
    if (!e) continue;
    switch (e.kind) {
      case 'point': out.add(e.id); break;
      case 'line': out.add(e.startId); out.add(e.endId); break;
      case 'circle': out.add(e.centerId); break;
      case 'arc': out.add(e.centerId); out.add(e.startId); out.add(e.endId); break;
      case 'ellipse': out.add(e.centerId); out.add(e.majorAxisEndId); break;
      case 'ellipticalArc': out.add(e.centerId); out.add(e.majorAxisEndId); break;
      case 'spline': for (const cp of e.controlPointIds) out.add(cp); break;
    }
  }
  return out;
}

export function moveEntities(
  state: SketchState, entityIds: string[], dx: number, dy: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to move' };
  if (Math.hypot(dx, dy) < EPS) return { state }; // no-op
  const pts = supportPointIds(state, entityIds);
  let s = state;
  s = {
    ...s,
    entities: s.entities.map(e => {
      if (e.kind === 'point' && pts.has(e.id) && e.id !== ORIGIN_POINT_ID) {
        return { ...e, x: e.x + dx, y: e.y + dy };
      }
      return e;
    }),
  };
  return { state: s, affectedIds: entityIds };
}

export function rotateEntities(
  state: SketchState, entityIds: string[], pivot: Pt, angleRad: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to rotate' };
  if (!isFinite(angleRad)) return { state, error: 'Invalid angle' };
  if (Math.abs(angleRad) < 1e-9) return { state };  // no-op
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  const pts = supportPointIds(state, entityIds);
  let s = state;
  s = {
    ...s,
    entities: s.entities.map(e => {
      if (e.kind === 'point' && pts.has(e.id) && e.id !== ORIGIN_POINT_ID) {
        const rx = e.x - pivot.x, ry = e.y - pivot.y;
        return { ...e, x: pivot.x + cos * rx - sin * ry, y: pivot.y + sin * rx + cos * ry };
      }
      return e;
    }),
  };
  return { state: s, affectedIds: entityIds };
}

export function scaleEntities(
  state: SketchState, entityIds: string[], pivot: Pt, factor: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to scale' };
  if (!isFinite(factor) || Math.abs(factor) < EPS) return { state, error: 'Scale factor must be non-zero' };
  if (Math.abs(factor - 1) < 1e-9) return { state };  // no-op
  const pts = supportPointIds(state, entityIds);
  const affected = new Set(entityIds);
  const radiusFactor = Math.abs(factor);
  let s = state;
  s = {
    ...s,
    entities: s.entities.map(e => {
      // Scale supporting points relative to the pivot.
      if (e.kind === 'point' && pts.has(e.id) && e.id !== ORIGIN_POINT_ID) {
        return {
          ...e,
          x: pivot.x + (e.x - pivot.x) * factor,
          y: pivot.y + (e.y - pivot.y) * factor,
        };
      }
      // Circles / arcs / ellipses carry their own radius parameter — scale
      // those too so the |start − center| invariant stays consistent with
      // the moved support points.
      if (affected.has(e.id) && (e.kind === 'circle' || e.kind === 'arc')) {
        return { ...e, radius: e.radius * radiusFactor };
      }
      if (affected.has(e.id) && e.kind === 'ellipse') {
        return { ...e, minorRadius: e.minorRadius * radiusFactor };
      }
      return e;
    }),
  };
  return { state: s, affectedIds: entityIds };
}

/**
 * Clone the given entities and translate the copies by (dx, dy). Each
 * entity becomes a fresh entity with new point ids; no constraints are
 * copied along. Returns the new entity ids in `affectedIds` so the editor
 * can highlight or re-select the copies.
 */
export function copyEntities(
  state: SketchState, entityIds: string[], dx: number, dy: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to copy' };
  const pts = supportPointIds(state, entityIds);
  let s = state;
  // Map original point id → cloned point id.
  const pointIdMap = new Map<string, string>();
  for (const oldId of pts) {
    if (oldId === ORIGIN_POINT_ID) {
      // Don't clone the origin — re-use it (every sketch has exactly one).
      pointIdMap.set(oldId, ORIGIN_POINT_ID);
      continue;
    }
    const orig = findPoint(s, oldId);
    if (!orig) continue;
    const r = addPoint(s, orig.x + dx, orig.y + dy);
    s = r.state;
    pointIdMap.set(oldId, r.id);
  }
  const createdEntityIds: string[] = [];
  for (const id of entityIds) {
    const e = findEntity(s, id);
    if (!e) continue;
    if (e.kind === 'point') {
      const cloneId = pointIdMap.get(e.id);
      if (cloneId) createdEntityIds.push(cloneId);
    } else if (e.kind === 'line') {
      const ns = pointIdMap.get(e.startId), ne = pointIdMap.get(e.endId);
      if (!ns || !ne) continue;
      const r = addLine(s, ns, ne); s = r.state;
      createdEntityIds.push(r.id);
    } else if (e.kind === 'circle') {
      const nc = pointIdMap.get(e.centerId);
      if (!nc) continue;
      const r = addCircleByPoint(s, nc, e.radius); s = r.state;
      createdEntityIds.push(r.id);
    } else if (e.kind === 'arc') {
      const nc = pointIdMap.get(e.centerId);
      const ns = pointIdMap.get(e.startId);
      const ne = pointIdMap.get(e.endId);
      if (!nc || !ns || !ne) continue;
      const r = addArcByPoints(s, nc, ns, ne, e.ccw); s = r.state;
      createdEntityIds.push(r.id);
    } else if (e.kind === 'ellipse') {
      const nc = pointIdMap.get(e.centerId);
      const nm = pointIdMap.get(e.majorAxisEndId);
      if (!nc || !nm) continue;
      const r = addEllipseByPoints(s, nc, nm, e.minorRadius); s = r.state;
      createdEntityIds.push(r.id);
    } else if (e.kind === 'spline') {
      const cps = e.controlPointIds.map(p => pointIdMap.get(p)).filter((p): p is string => !!p);
      if (cps.length !== e.controlPointIds.length) continue;
      const r = addSplineByPoints(s, cps, e.degree); s = r.state;
      createdEntityIds.push(r.id);
    }
  }
  // Suppress the no-op-translation case from emitting nothing: even a (0, 0)
  // copy is useful (it duplicates in place).
  void dx; void dy;
  return { state: s, affectedIds: createdEntityIds };
}
