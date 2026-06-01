import type {
  SketchState, SketchEntity, LineEntity, CircleEntity, ArcEntity, PointEntity,
  ConstraintType, SketchConstraint,
} from './types';
import { findEntity, findPoint } from './types';
import {
  addPoint, addLine, addArc, addArcByPoints, addCircle, addCircleByPoint,
  addEllipseByPoints, addSplineByPoints, addConstraint, deletePrimitive,
  addRectangleCorners, addRectangleCenter,
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

  // Same nearest-on-either-side picking as trimLine, but here we only
  // need the t-values to build the preview segment — the intersection
  // metadata is irrelevant for rendering.
  let leftHit: number | null = null;
  let rightHit: number | null = null;
  for (const h of hits) {
    if (h.t < tClick - EPS) {
      if (leftHit === null || h.t > leftHit) leftHit = h.t;
    } else if (h.t > tClick + EPS) {
      if (rightHit === null || h.t < rightHit) rightHit = h.t;
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

/** What the Trim tool would remove on a circle. Returns a tessellated
 * polyline along the arc segment between the two intersections that
 * bracket the click angle (or the full circle when no/one
 * intersection). Mirrors `trimCircle`. */
export function previewTrimCircle(state: SketchState, circleId: string, click: Pt): Pt[] | null {
  const circle = findEntity<CircleEntity>(state, circleId);
  if (!circle || circle.kind !== 'circle' || circle.construction) return null;
  const center = findPoint(state, circle.centerId);
  if (!center) return null;
  const r = circle.radius;
  const hits = collectCircleHits(state, circle, center);
  // No / single hit → entire circle is removed.
  if (hits.length < 2) {
    return tessellateCircleArc(center, r, 0, 2 * Math.PI, true);
  }
  const angles = hits.map(h => h.angle);
  const clickAngle = normalizeAngle(Math.atan2(click.y - center.y, click.x - center.x));
  const sorted = angles.map(normalizeAngle).slice().sort((a, b) => a - b);
  // Bracket the click angle between two consecutive hits (with wrap).
  let prevA = sorted[sorted.length - 1] - 2 * Math.PI;
  let nextA = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] <= clickAngle + EPS) prevA = sorted[i];
    if (sorted[i] > clickAngle - EPS) { nextA = sorted[i]; break; }
  }
  if (nextA <= clickAngle) nextA = sorted[0] + 2 * Math.PI;
  // Removed wedge: CCW from prevA to nextA, passing through the click.
  return tessellateCircleArc(center, r, prevA, nextA, true);
}

/** What the Trim tool would remove on an arc. Mirrors `trimArc`. */
export function previewTrimArc(state: SketchState, arcId: string, click: Pt): Pt[] | null {
  const arc = findEntity<ArcEntity>(state, arcId);
  if (!arc || arc.kind !== 'arc' || arc.construction) return null;
  const center = findPoint(state, arc.centerId);
  const sp = findPoint(state, arc.startId);
  const ep = findPoint(state, arc.endId);
  if (!center || !sp || !ep) return null;
  const startA = Math.atan2(sp.y - center.y, sp.x - center.x);
  const endA = Math.atan2(ep.y - center.y, ep.x - center.x);
  const hits = collectArcHits(state, arc, center, startA, endA);
  const sweep = arcOffset(startA, endA, arc.ccw);
  if (sweep < EPS) return null;
  const clickAngle = Math.atan2(click.y - center.y, click.x - center.x);
  const clickOff = arcOffset(startA, clickAngle, arc.ccw);
  if (clickOff < -EPS || clickOff > sweep + EPS) return null;
  const offs = hits.map(h => arcOffset(startA, h.angle, arc.ccw))
    .filter(o => o > EPS && o < sweep - EPS);
  let leftOff: number | null = null;
  let rightOff: number | null = null;
  for (const o of offs) {
    if (o < clickOff - EPS) {
      if (leftOff === null || o > leftOff) leftOff = o;
    } else if (o > clickOff + EPS) {
      if (rightOff === null || o < rightOff) rightOff = o;
    }
  }
  // The removed segment is the wedge between leftOff (or 0) and
  // rightOff (or sweep) — i.e. the piece bracketing the click.
  const o0 = leftOff !== null ? leftOff : 0;
  const o1 = rightOff !== null ? rightOff : sweep;
  if (o1 - o0 < EPS) return null;
  const a0 = startA + (arc.ccw ? o0 : -o0);
  const a1 = startA + (arc.ccw ? o1 : -o1);
  return tessellateCircleArc(center, arc.radius, a0, a1, arc.ccw);
}

/** Tessellate a circular arc as a polyline. `ccw` controls sweep
 * direction; the returned points include both endpoints. Segment
 * count scales with sweep so the visible chord error stays small. */
function tessellateCircleArc(center: Pt, radius: number, fromA: number, toA: number, ccw: boolean): Pt[] {
  let sweep = toA - fromA;
  if (ccw) {
    while (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    while (sweep >= 0) sweep -= 2 * Math.PI;
    sweep = Math.abs(sweep);
  }
  const segs = Math.max(8, Math.min(96, Math.ceil(sweep / (Math.PI / 32))));
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = ccw ? fromA + sweep * t : fromA - sweep * t;
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return out;
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
  let leftHit: LineHit | null = null;   // largest t < tClick
  let rightHit: LineHit | null = null;  // smallest t > tClick
  for (const h of hits) {
    if (h.t < tClick - EPS) {
      if (leftHit === null || h.t > leftHit.t) leftHit = h;
    } else if (h.t > tClick + EPS) {
      if (rightHit === null || h.t < rightHit.t) rightHit = h;
    }
  }

  // Case A: both sides bounded → split into two segments and drop the
  // middle piece (the segment under the cursor). Each new endpoint is
  // pinned to the curve it landed on via a coincident constraint so the
  // sub-segments stay attached to the intersected curve when it moves.
  if (leftHit !== null && rightHit !== null) {
    return splitLineKeepingOnly(state, line, a, b, [
      { t0: 0, t1: leftHit.t, pin0: null, pin1: leftHit.intersectedEntityId },
      { t0: rightHit.t, t1: 1, pin0: rightHit.intersectedEntityId, pin1: null },
    ]);
  }
  if (leftHit === null && rightHit !== null) {
    // Click sits to the left of every hit → shorten by moving start to rightHit.
    return splitLineKeepingOnly(state, line, a, b, [
      { t0: rightHit.t, t1: 1, pin0: rightHit.intersectedEntityId, pin1: null },
    ]);
  }
  if (leftHit !== null && rightHit === null) {
    return splitLineKeepingOnly(state, line, a, b, [
      { t0: 0, t1: leftHit.t, pin0: null, pin1: leftHit.intersectedEntityId },
    ]);
  }
  // Shouldn't be reachable.
  return { state, error: 'Trim could not classify click' };
}

/** Replace `line` with one or more sub-segments specified as t-parameter
 * pairs along the original. Each kept segment becomes a new line entity.
 *
 * `pin0` / `pin1` (when non-null) name the entity each endpoint should
 * be coincident-constrained to — typically the curve that produced the
 * intersection at that end of the kept segment. SolidWorks-style: the
 * trimmed line sub-segment stays attached to the curve that bounded it
 * when that curve moves. */
interface KeptSegment { t0: number; t1: number; pin0: string | null; pin1: string | null; }
function splitLineKeepingOnly(
  state: SketchState, line: LineEntity, a: Pt, b: Pt,
  kept: KeptSegment[],
): OpResult {
  // Carry forward direction / parallelism / equality constraints onto
  // EVERY kept sub-segment — without this, trimming a horizontal line
  // silently drops its `horizontal` constraint and the sub-line
  // becomes free to rotate. Dimensional length-based constraints
  // (distance / equal-length) are intentionally NOT inherited: the
  // sub-segment has a different length, so applying the original
  // dim would over-constrain or contradict.
  //
  // The SolidWorks `on-edge` link is also inherited: when a converted
  // line is trimmed, the surviving sub-segments STAY linked to the
  // source body edge. The re-projection loop skips endpoints that
  // have other anchoring constraints (e.g., the trim point coincident
  // with the cutting curve) so the trim isn't undone on regen.
  const inheritedConstraints = state.constraints.filter(c =>
    c.targets.some(t => t.entityId === line.id)
    && (isDirectionConstraint(c.type) || c.type === 'on-edge'),
  );
  let s = deletePrimitive(state, line.id);
  const newIds: string[] = [];
  const segDebug: Array<{ t0: number; t1: number; newId: string; pa: Pt; pb: Pt; pin0: string | null; pin1: string | null; paReused: boolean; pbReused: boolean }> = [];
  for (const seg of kept) {
    if (Math.abs(seg.t1 - seg.t0) < EPS) continue;
    const p0 = { x: a.x + (b.x - a.x) * seg.t0, y: a.y + (b.y - a.y) * seg.t0 };
    const p1 = { x: a.x + (b.x - a.x) * seg.t1, y: a.y + (b.y - a.y) * seg.t1 };
    // SolidWorks-style: when a point already exists at the trim
    // endpoint coord, REUSE it instead of creating a duplicate. The
    // intersection point of the trim line with a cutter is typically
    // already a point in the sketch (the cutter's own endpoint, a
    // user-placed coincident-on-curve marker, etc.) — reusing it
    // means the new sub-segment endpoint inherits that point's
    // existing constraints rather than spawning a parallel coincident.
    const paRes = acquireOrCreatePoint(s, p0.x, p0.y); s = paRes.state;
    const pbRes = acquireOrCreatePoint(s, p1.x, p1.y); s = pbRes.state;
    const lr = addLine(s, paRes.id, pbRes.id); s = lr.state;
    newIds.push(lr.id);
    // Pin each freshly-created endpoint to the curve that bounded it.
    // Skip when the (reused) point is ALREADY coincident with that
    // cutter — adding a redundant constraint clutters the sidebar and
    // can trip the solver's redundancy heuristic.
    if (seg.pin0 && !alreadyCoincidentWith(s, paRes.id, seg.pin0)) {
      s = addConstraint(s, 'coincident', [paRes.id, seg.pin0]).state;
    }
    if (seg.pin1 && !alreadyCoincidentWith(s, pbRes.id, seg.pin1)) {
      s = addConstraint(s, 'coincident', [pbRes.id, seg.pin1]).state;
    }
    segDebug.push({ t0: seg.t0, t1: seg.t1, newId: lr.id, pa: p0, pb: p1, pin0: seg.pin0, pin1: seg.pin1, paReused: paRes.existed, pbReused: pbRes.existed });
  }
  s = inheritConstraintsOntoMultiple(s, line.id, newIds, inheritedConstraints);
  // Diagnostic dump for "trim still broken on converted line". Enable
  // with `window.__cadDebug = true`; silent otherwise. Logs the
  // inherited constraints (incl. on-edge externalRef), each kept
  // sub-segment's endpoints + pins, and the final on-edge constraints
  // post-inheritance so we can verify the link IS attached to the
  // sub-segment with the right externalRef.
  if (typeof globalThis !== 'undefined'
      && (globalThis as { __cadDebug?: boolean }).__cadDebug) {
    const payload = {
      originalId: line.id,
      originalEndpoints: { a, b },
      inherited: inheritedConstraints.map(c => ({
        id: c.id, type: c.type,
        targets: c.targets.map(t => t.entityId),
        externalRef: c.externalRef,
      })),
      keptSegments: segDebug,
      newOnEdge: s.constraints
        .filter(c => c.type === 'on-edge' && newIds.some(id => c.targets.some(t => t.entityId === id)))
        .map(c => ({
          id: c.id,
          target: c.targets[0]?.entityId,
          externalRef: c.externalRef,
        })),
    };
    // eslint-disable-next-line no-console
    console.log('[cad-trim:line]\n' + JSON.stringify(payload, null, 2));
  }
  return { state: s, affectedIds: newIds };
}

/** Find a point already sitting at (x, y) within ACQUIRE_TOL, or
 * synthesise a fresh one. Used by trim's split helpers so the new
 * sub-segment endpoints attach to existing intersection points (the
 * cutter's endpoint, a coincident-on-curve marker, …) instead of
 * spawning duplicates. Tolerance is wider than the convert path's
 * 1e-4 because trim coords come from t-parameter math that drifts
 * a bit more under floating-point. */
function acquireOrCreatePoint(
  state: SketchState, x: number, y: number,
): { state: SketchState; id: string; existed: boolean } {
  const ACQUIRE_TOL = 1e-3;
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    if (Math.hypot(e.x - x, e.y - y) <= ACQUIRE_TOL) {
      return { state, id: e.id, existed: true };
    }
  }
  const r = addPoint(state, x, y);
  return { state: r.state, id: r.id, existed: false };
}

/** True when a `coincident` constraint between `pointId` and `otherId`
 * is already in the sketch. Used to avoid emitting a redundant
 * coincident when trim's reused point already carries the link. */
function alreadyCoincidentWith(
  state: SketchState, pointId: string, otherId: string,
): boolean {
  for (const c of state.constraints) {
    if (c.type !== 'coincident') continue;
    const ids = c.targets.map(t => t.entityId);
    if (ids.includes(pointId) && ids.includes(otherId)) return true;
  }
  return false;
}

/** Like `inheritConstraintsOntoEntity` but for the multi-target case:
 * each new id gets its own copy of every inherited constraint, with
 * unique constraint ids so the doc stays well-formed. Used by line
 * trim where a single mid-segment cut produces TWO sub-segments and
 * each needs the direction / on-edge constraints reattached. */
function inheritConstraintsOntoMultiple(
  state: SketchState, oldId: string, newIds: string[],
  inherited: ReadonlyArray<SketchConstraint>,
): SketchState {
  if (inherited.length === 0 || newIds.length === 0) return state;
  const newConstraints: SketchConstraint[] = [];
  for (let i = 0; i < newIds.length; i++) {
    for (const c of inherited) {
      newConstraints.push({
        ...c,
        id: i === 0 ? c.id : `${c.id}_seg${i}`,
        targets: c.targets.map(t => t.entityId === oldId ? { ...t, entityId: newIds[i] } : t),
      });
    }
  }
  return { ...state, constraints: [...state.constraints, ...newConstraints] };
}

/** Direction-class constraints (`horizontal`, `parallel`, …) are
 * length-agnostic and safely transfer to a trimmed sub-segment.
 * Length-class ones (`distance`, `equal`) are not — the sub-segment
 * has a different length, so applying the original value would
 * over-constrain or contradict. */
function isDirectionConstraint(type: ConstraintType): boolean {
  return type === 'horizontal' || type === 'vertical'
    || type === 'parallel' || type === 'perpendicular'
    || type === 'collinear' || type === 'angle';
}

/** A trim hit on `line` produced by another curve. `t` is the parameter
 * along the line (0 = start, 1 = end); `intersectedEntityId` is the id of
 * the curve that produced the hit, so trim's post-split point can be
 * pinned to that curve via a coincident constraint. */
interface LineHit { t: number; intersectedEntityId: string; }

/** Hit parameters (t in [0,1]) where `line` is crossed by every other
 * non-construction curve. Excludes endpoint touches. */
function collectLineHits(
  state: SketchState, line: LineEntity, a: Pt, b: Pt,
): LineHit[] {
  const out: LineHit[] = [];
  for (const e of state.entities) {
    if (e.id === line.id || e.construction) continue;
    if (e.kind === 'line') {
      const oa = findPoint(state, e.startId);
      const ob = findPoint(state, e.endId);
      if (!oa || !ob) continue;
      const r = lineLineIntersection(a, b, oa, ob);
      if (!r) continue;
      // t1 = parameter along the trimmed line; exclude endpoint touches
      // (the line's own endpoints are already implicit boundaries).
      // t2 = parameter along the cutting line; ACCEPT endpoint touches
      // — a sketched line ending exactly on the trimmed line is a
      // legitimate T-junction that should bound the trim. Without
      // allowing t2 == 0 or 1, every T-junction was being treated as
      // "no intersection" and the trimmed line got deleted wholesale.
      if (r.t1 > EPS && r.t1 < 1 - EPS && r.t2 >= -EPS && r.t2 <= 1 + EPS) {
        out.push({ t: r.t1, intersectedEntityId: e.id });
      }
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, (e as CircleEntity).centerId);
      if (!ce) continue;
      const pts = lineCircleIntersection(a, b, ce, (e as CircleEntity).radius);
      for (const p of pts) for (const t of tForPoint(a, b, p)) out.push({ t, intersectedEntityId: e.id });
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
          for (const t of tForPoint(a, b, p)) out.push({ t, intersectedEntityId: e.id });
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
  const hits = collectCircleHits(state, circle, center);
  if (hits.length === 0) {
    return { state: deletePrimitive(state, circle.id), affectedIds: [] };
  }
  if (hits.length === 1) {
    // Single crossing — can't cut into an arc segment cleanly. Delete it.
    return { state: deletePrimitive(state, circle.id), affectedIds: [] };
  }
  // Click angle.
  const clickAngle = normalizeAngle(Math.atan2(click.y - center.y, click.x - center.x));
  // Sort hits by normalized angle so the bracket walk is monotonic.
  // Keep the original hit (with its pointId / curveId source) attached
  // so the trim can anchor the new arc's endpoints to the right entity.
  const sortedHits = hits
    .map(h => ({ ...h, angle: normalizeAngle(h.angle) }))
    .sort((a, b) => a.angle - b.angle);
  let prevHit: CircleHit = { ...sortedHits[sortedHits.length - 1], angle: sortedHits[sortedHits.length - 1].angle - 2 * Math.PI };
  let nextHit: CircleHit = sortedHits[0];
  for (let i = 0; i < sortedHits.length; i++) {
    if (sortedHits[i].angle <= clickAngle + EPS) prevHit = sortedHits[i];
    if (sortedHits[i].angle > clickAngle - EPS) { nextHit = sortedHits[i]; break; }
  }
  if (nextHit.angle <= clickAngle) {
    nextHit = { ...sortedHits[0], angle: sortedHits[0].angle + 2 * Math.PI };
  }
  // Capture every constraint touching the circle BEFORE the delete —
  // deletePrimitive drops them as a side-effect, and they'd be lost
  // otherwise. We'll rewire each onto the replacement arc.
  const inheritedConstraints = state.constraints.filter(
    c => c.targets.some(t => t.entityId === circle.id),
  );
  // Remove the wedge between prevHit and nextHit (the side under the click), keep
  // the rest as an arc from nextHit → prevHit + 2π going CCW.
  let s = deletePrimitive(state, circle.id);
  const r = circle.radius;
  // Reuse the original center point id when possible so constraints
  // attached to the center (fixed, coincident-with-origin, …) survive
  // the trim. Falls back to a fresh point if the center was cascaded
  // out by the delete.
  const centerId = s.entities.some(e => e.id === circle.centerId)
    ? circle.centerId
    : (() => { const r2 = addPoint(s, center.x, center.y); s = r2.state; return r2.id; })();
  // Resolve each arc endpoint from its hit source:
  //   - point source → reuse the existing point id directly (free
  //     coincident-with-circumference baked into the identity).
  //   - curve source → create a new endpoint and pin it to that curve
  //     via a coincident constraint so the endpoint sticks to the
  //     intersected curve when either side moves.
  //   - no source (extrapolated bracket) → fresh point, no anchor.
  const resolveEndpoint = (hit: CircleHit): string => {
    if (hit.pointId && s.entities.some(e => e.id === hit.pointId)) {
      return hit.pointId;
    }
    const px = center.x + r * Math.cos(hit.angle);
    const py = center.y + r * Math.sin(hit.angle);
    const np = addPoint(s, px, py); s = np.state;
    if (hit.curveId && s.entities.some(e => e.id === hit.curveId)) {
      s = addConstraint(s, 'coincident', [np.id, hit.curveId]).state;
    }
    return np.id;
  };
  const startId = resolveEndpoint(nextHit);
  const endId = resolveEndpoint(prevHit);
  const ar = addArcByPoints(s, centerId, startId, endId, true);
  s = ar.state;
  s = inheritConstraintsOntoEntity(s, circle.id, ar.id, inheritedConstraints);
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
  // Decorate hits with their sweep-offset so we can bracket the click
  // and still recover each hit's source (point / curve) for the new
  // arc-endpoint resolution.
  const hitsByOffset = hits
    .map(h => ({ ...h, off: offset(h.angle) }))
    .filter(h => h.off > EPS && h.off < sweep - EPS);

  let left: (typeof hitsByOffset)[number] | null = null;
  let right: (typeof hitsByOffset)[number] | null = null;
  for (const h of hitsByOffset) {
    if (h.off < clickOff - EPS) {
      if (left === null || h.off > left.off) left = h;
    } else if (h.off > clickOff + EPS) {
      if (right === null || h.off < right.off) right = h;
    }
  }
  // Keep segments [0..left, right..sweep] as separate arcs. Each entry
  // records the keep range PLUS the hit at each boundary (null when
  // the boundary is the original arc start/end — those reuse the
  // arc's own start/end point ids).
  type KeepSeg = {
    o0: number; o1: number;
    h0: CircleHit | null; h1: CircleHit | null;
  };
  const keep: KeepSeg[] = [];
  if (left !== null && right !== null) {
    keep.push({ o0: 0, o1: left.off, h0: null, h1: left });
    keep.push({ o0: right.off, o1: sweep, h0: right, h1: null });
  } else if (left !== null) {
    keep.push({ o0: 0, o1: left.off, h0: null, h1: left });
  } else if (right !== null) {
    keep.push({ o0: right.off, o1: sweep, h0: right, h1: null });
  } else {
    return { state: deletePrimitive(state, arc.id), affectedIds: [] };
  }

  const inheritedConstraints = state.constraints.filter(
    c => c.targets.some(t => t.entityId === arc.id),
  );
  let s = deletePrimitive(state, arc.id);
  const centerId = s.entities.some(e => e.id === arc.centerId)
    ? arc.centerId
    : (() => { const r2 = addPoint(s, center.x, center.y); s = r2.state; return r2.id; })();
  // Resolve an arc endpoint either by reusing the source point id, by
  // creating a fresh point pinned to the intersected curve via
  // coincident, or by reusing the original arc's own start/end id
  // (when this boundary is the original arc start / end).
  const resolveEndpoint = (hit: CircleHit | null, off: number, fallbackOwnId: string): string => {
    if (!hit) {
      // Original arc boundary — keep the original start or end point
      // id so any constraints / coincidents on it survive.
      if (s.entities.some(e => e.id === fallbackOwnId)) return fallbackOwnId;
      const ang = startA + (arc.ccw ? off : -off);
      const px = center.x + arc.radius * Math.cos(ang);
      const py = center.y + arc.radius * Math.sin(ang);
      const np = addPoint(s, px, py); s = np.state;
      return np.id;
    }
    if (hit.pointId && s.entities.some(e => e.id === hit.pointId)) return hit.pointId;
    const ang = startA + (arc.ccw ? off : -off);
    const px = center.x + arc.radius * Math.cos(ang);
    const py = center.y + arc.radius * Math.sin(ang);
    const np = addPoint(s, px, py); s = np.state;
    if (hit.curveId && s.entities.some(e => e.id === hit.curveId)) {
      s = addConstraint(s, 'coincident', [np.id, hit.curveId]).state;
    }
    return np.id;
  };
  const newIds: string[] = [];
  for (const k of keep) {
    if (Math.abs(k.o1 - k.o0) < EPS) continue;
    const startId = resolveEndpoint(k.h0, k.o0, arc.startId);
    const endId   = resolveEndpoint(k.h1, k.o1, arc.endId);
    const ar = addArcByPoints(s, centerId, startId, endId, arc.ccw);
    s = ar.state;
    newIds.push(ar.id);
  }
  if (newIds.length > 0) {
    s = inheritConstraintsOntoEntity(s, arc.id, newIds[0], inheritedConstraints);
  }
  return { state: s, affectedIds: newIds };
}

/** Rewire a set of constraints — all originally targeting `oldId` — onto
 * `newId`, then append them back into `state.constraints`. Used after a
 * trim deletes the source curve and creates a replacement: without
 * this, every constraint that referenced the source (radius, tangent,
 * point-on-curve, …) is silently dropped by deletePrimitive's cascade. */
function inheritConstraintsOntoEntity(
  state: SketchState, oldId: string, newId: string,
  inherited: ReadonlyArray<SketchConstraint>,
): SketchState {
  if (inherited.length === 0) return state;
  const rewired = inherited.map(c => ({
    ...c,
    targets: c.targets.map(t => t.entityId === oldId ? { ...t, entityId: newId } : t),
  }));
  return { ...state, constraints: [...state.constraints, ...rewired] };
}

/** A hit along a circle: the angle around the center, plus the entity
 * that produced the hit so the trim can wire its new arc endpoint to
 * the right anchor. `pointId` is set when a standalone point sits ON
 * the circle (we'll reuse it as the arc endpoint). `curveId` is set
 * when another curve crosses the circle (we'll create a new endpoint
 * and pin it to that curve via coincident). */
interface CircleHit { angle: number; pointId?: string; curveId?: string; }

function collectCircleHits(state: SketchState, circle: CircleEntity, center: Pt): CircleHit[] {
  const out: CircleHit[] = [];
  // Point entities sitting ON the circle count as cut points too — a
  // user-placed point on the circumference (with or without an
  // explicit point-on-curve constraint) signals "cut here." Test
  // against radius with a generous tolerance so floating-point drift
  // doesn't disqualify a point the user clearly intended to land on
  // the curve. Construction points participate (they're reference
  // markers, not visual-only).
  const circleTol = Math.max(circle.radius * 1e-4, 1e-4);
  // Avoid double-counting the curve's own controlling vertices when
  // we walk through standalone points — for a Circle, that's just
  // the center (which trivially fails the radius test anyway). For
  // safety, exclude the center id explicitly.
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    if (e.id === circle.centerId) continue;
    const dr = Math.hypot(e.x - center.x, e.y - center.y) - circle.radius;
    if (Math.abs(dr) <= circleTol) {
      out.push({ angle: Math.atan2(e.y - center.y, e.x - center.x), pointId: e.id });
    }
  }
  for (const e of state.entities) {
    if (e.id === circle.id || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const pts = lineCircleIntersection(a, b, center, circle.radius);
      for (const p of pts) {
        const t = lineParam(a, b, p);
        // ACCEPT endpoint touches on the cutting line — a sketched
        // line whose endpoint lands ON the circle (T-junction) is a
        // legitimate trim boundary. EPS slack keeps numerical drift
        // from falsely rejecting an exact endpoint hit.
        if (t !== null && t >= -EPS && t <= 1 + EPS) {
          out.push({ angle: Math.atan2(p.y - center.y, p.x - center.x), curveId: e.id });
        }
      }
    } else if (e.kind === 'circle') {
      const oc = findPoint(state, (e as CircleEntity).centerId);
      if (!oc) continue;
      const pts = circleCircleIntersection(center, circle.radius, oc, (e as CircleEntity).radius);
      for (const p of pts) {
        out.push({ angle: Math.atan2(p.y - center.y, p.x - center.x), curveId: e.id });
      }
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
          out.push({ angle: Math.atan2(p.y - center.y, p.x - center.x), curveId: e.id });
        }
      }
    }
  }
  return out;
}

function collectArcHits(
  state: SketchState, arc: ArcEntity, center: Pt, startA: number, endA: number,
): CircleHit[] {
  const out: CircleHit[] = [];
  // Standalone points sitting on the arc's circle within its sweep
  // count as cut markers — same rationale as collectCircleHits.
  // Exclude the arc's own controlling points (start/end/center)
  // since those define the arc's domain rather than cut it.
  const arcTol = Math.max(arc.radius * 1e-4, 1e-4);
  const ownPoints = new Set([arc.centerId, arc.startId, arc.endId]);
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    if (ownPoints.has(e.id)) continue;
    const dr = Math.hypot(e.x - center.x, e.y - center.y) - arc.radius;
    if (Math.abs(dr) > arcTol) continue;
    const ang = Math.atan2(e.y - center.y, e.x - center.x);
    if (angleInArcSweep(ang, startA, endA, arc.ccw)) out.push({ angle: ang, pointId: e.id });
  }
  for (const e of state.entities) {
    if (e.id === arc.id || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const pts = lineCircleIntersection(a, b, center, arc.radius);
      for (const p of pts) {
        const t = lineParam(a, b, p);
        // ACCEPT endpoint touches on the cutting line — T-junctions
        // where a sketched line's endpoint lands on the arc are valid
        // trim boundaries. Same fix as collectLineHits / collectCircleHits.
        if (t === null || t < -EPS || t > 1 + EPS) continue;
        const ang = Math.atan2(p.y - center.y, p.x - center.x);
        if (angleInArcSweep(ang, startA, endA, arc.ccw)) out.push({ angle: ang, curveId: e.id });
      }
    } else if (e.kind === 'circle') {
      const oc = findPoint(state, (e as CircleEntity).centerId);
      if (!oc) continue;
      const pts = circleCircleIntersection(center, arc.radius, oc, (e as CircleEntity).radius);
      for (const p of pts) {
        const ang = Math.atan2(p.y - center.y, p.x - center.x);
        if (angleInArcSweep(ang, startA, endA, arc.ccw)) out.push({ angle: ang, curveId: e.id });
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
          out.push({ angle: angSelf, curveId: e.id });
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

/** Find every non-construction curve reachable from `startId` via
 * shared endpoint points. Used by the Offset sidebar's "chain
 * selection" mode: clicking one segment of a polyline pulls in every
 * connected segment so the user can offset the whole chain in one
 * gesture instead of clicking each piece. Lines and arcs participate;
 * circles don't (they have no endpoints).
 *
 * Iterative BFS, capped at the entity count so a malformed graph
 * can't loop forever. */
/** Propagate the seed click's "side" to every curve in a chain so all
 * offsets land on the same logical side of the chain — even when
 * segments are stored with mixed directions. Two modes:
 *   - CLOSED loop: detect inside/outside of the polygon at the seed
 *     click; each curve's sidePoint is on the same side (in or out).
 *     Guarantees no offset crosses the original loop.
 *   - OPEN chain: walk from one end to the other, build per-curve
 *     traversal directions, propagate the seed's LEFT/RIGHT handedness
 *     to each. All offsets go in the same direction relative to chain
 *     travel.
 * Branching chains (a vertex with > 2 incident curves) fall back to
 * the simple "seed click everywhere" — they're not a single chain in
 * the traversal sense. Caller passes the Set as returned by
 * `findChainedEntities` (which always includes the seed itself). */
export function propagateOffsetSides(
  state: SketchState, seedId: string, seedClick: Pt, chainIds: Iterable<string>,
): Map<string, Pt> {
  const out = new Map<string, Pt>();
  out.set(seedId, seedClick);
  const ids = [...chainIds];
  if (ids.length < 2) return out;  // single curve — only the seed
  // Build adjacency keyed by quantised coords so user-drawn segments
  // with slightly-different point IDs at a shared corner still chain.
  const keyOf = (pt: Pt) => `${Math.round(pt.x * 1000)},${Math.round(pt.y * 1000)}`;
  type CurveInfo = { startKey: string; endKey: string; startPt: Pt; endPt: Pt; kind: 'line' | 'arc' };
  const info = new Map<string, CurveInfo>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    const e = findEntity(state, id);
    if (!e || (e.kind !== 'line' && e.kind !== 'arc')) continue;
    const sp = findPoint(state, (e as LineEntity | ArcEntity).startId);
    const ep = findPoint(state, (e as LineEntity | ArcEntity).endId);
    if (!sp || !ep) continue;
    const sk = keyOf(sp), ek = keyOf(ep);
    info.set(id, { startKey: sk, endKey: ek, startPt: sp, endPt: ep, kind: e.kind });
    if (!adj.has(sk)) adj.set(sk, []);
    if (!adj.has(ek)) adj.set(ek, []);
    adj.get(sk)!.push(id);
    adj.get(ek)!.push(id);
  }
  // Classify chain shape: closed (all vertices degree 2), open (two
  // degree-1 vertices), or branching (any vertex of degree 3+).
  let openEndpoint: string | null = null;
  let branching = false;
  for (const [k, vs] of adj) {
    if (vs.length === 1) {
      openEndpoint = openEndpoint ?? k;
    } else if (vs.length !== 2) {
      branching = true;
      break;
    }
  }
  if (branching) {
    // Best-effort fallback: every non-seed curve reuses the seed click.
    for (const id of ids) if (id !== seedId) out.set(id, seedClick);
    return out;
  }
  const isClosed = !openEndpoint;
  // Walk the chain into [curve_ids] and [vertices]. For closed loops,
  // start at the seed's start endpoint and walk back to it.
  const seedInfo = info.get(seedId);
  if (!seedInfo) return out;
  const startKey = isClosed ? seedInfo.startKey : openEndpoint!;
  // For closed loops the entry curve = seed. For open chains entry = the curve at the open endpoint.
  let curId: string;
  if (isClosed) {
    curId = seedId;
  } else {
    const cands = adj.get(startKey) || [];
    if (cands.length === 0) return out;
    curId = cands[0];
  }
  const orderedCurves: string[] = [];
  const orderedVertices: Pt[] = [];
  const visited = new Set<string>();
  let entryKey = startKey;
  while (curId) {
    if (visited.has(curId)) break;
    visited.add(curId);
    const ci = info.get(curId);
    if (!ci) break;
    const entryPt = ci.startKey === entryKey ? ci.startPt : ci.endPt;
    const exitKey = ci.startKey === entryKey ? ci.endKey : ci.startKey;
    const exitPt = ci.startKey === entryKey ? ci.endPt : ci.startPt;
    if (orderedVertices.length === 0) orderedVertices.push(entryPt);
    orderedVertices.push(exitPt);
    orderedCurves.push(curId);
    // Next curve sharing exitKey.
    const nextIds = (adj.get(exitKey) || []).filter(nid => nid !== curId);
    if (nextIds.length === 0) break;
    const nextId = nextIds[0];
    if (visited.has(nextId)) break;
    curId = nextId;
    entryKey = exitKey;
  }
  // Seed click's handedness relative to seed's TRAVERSAL direction
  // (not necessarily its stored direction). Cross of forward × (click - midpoint):
  //   positive → LEFT of forward, negative → RIGHT.
  const seedCurveIdx = orderedCurves.indexOf(seedId);
  if (seedCurveIdx < 0) return out;
  const seedEntry = orderedVertices[seedCurveIdx];
  const seedExit = orderedVertices[seedCurveIdx + 1];
  if (!seedEntry || !seedExit) return out;
  const sfx = seedExit.x - seedEntry.x, sfy = seedExit.y - seedEntry.y;
  const sflen = Math.hypot(sfx, sfy);
  if (sflen < 1e-6) return out;
  const sfu = { x: sfx / sflen, y: sfy / sflen };
  const seedMid = { x: (seedEntry.x + seedExit.x) / 2, y: (seedEntry.y + seedExit.y) / 2 };
  const cross = sfu.x * (seedClick.y - seedMid.y) - sfu.y * (seedClick.x - seedMid.x);
  const seedSign = cross >= 0 ? 1 : -1;  // +1 LEFT of forward, -1 RIGHT
  if (isClosed) {
    // For closed loops use point-in-polygon: every offset stays on the
    // same side of the boundary as the seed click did. Guarantees no
    // offset crosses the original loop.
    const polygon = orderedVertices.slice(0, -1);  // drop closing duplicate
    const seedInside = _polygonContains(polygon, seedClick);
    for (let i = 0; i < orderedCurves.length; i++) {
      const id = orderedCurves[i];
      if (id === seedId) continue;
      const entry = orderedVertices[i];
      const exit  = orderedVertices[i + 1];
      const mid = { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 };
      const fx = exit.x - entry.x, fy = exit.y - entry.y;
      const flen = Math.hypot(fx, fy);
      if (flen < 1e-6) { out.set(id, seedClick); continue; }
      const perpL = { x: -fy / flen, y: fx / flen };
      // Test which perpendicular's side matches seed's inside/outside.
      const testL = { x: mid.x + perpL.x * 0.5, y: mid.y + perpL.y * 0.5 };
      const testLInside = _polygonContains(polygon, testL);
      const chosen = (seedInside === testLInside) ? perpL : { x: -perpL.x, y: -perpL.y };
      out.set(id, { x: mid.x + chosen.x * 10, y: mid.y + chosen.y * 10 });
    }
  } else {
    // Open chain: propagate seed handedness through traversal-forward
    // direction of each curve.
    for (let i = 0; i < orderedCurves.length; i++) {
      const id = orderedCurves[i];
      if (id === seedId) continue;
      const entry = orderedVertices[i];
      const exit  = orderedVertices[i + 1];
      const mid = { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 };
      const fx = exit.x - entry.x, fy = exit.y - entry.y;
      const flen = Math.hypot(fx, fy);
      if (flen < 1e-6) { out.set(id, seedClick); continue; }
      const perp = seedSign > 0
        ? { x: -fy / flen, y: fx / flen }
        : { x: fy / flen, y: -fx / flen };
      out.set(id, { x: mid.x + perp.x * 10, y: mid.y + perp.y * 10 });
    }
  }
  return out;
}

/** Point-in-polygon via standard ray-cast crossings test. Local copy
 * so propagateOffsetSides doesn't drag in profile.ts. */
function _polygonContains(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findChainedEntities(state: SketchState, startId: string): Set<string> {
  const reached = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const ent = findEntity(state, id);
    if (!ent) continue;
    const eps = endpointKeysOf(state, ent);
    if (eps.length === 0) continue;
    for (const other of state.entities) {
      if (reached.has(other.id)) continue;
      // Construction is allowed as an offset source — see offsetCurve.
      const oeps = endpointKeysOf(state, other);
      if (oeps.length === 0) continue;
      // Coord-based matching so user-drawn polylines (where each
      // segment carries its own point ids, coincidence-constrained
      // rather than id-shared) chain correctly.
      if (oeps.some(k => eps.includes(k))) {
        reached.add(other.id);
        queue.push(other.id);
      }
    }
  }
  return reached;
}

/** Canonical key for a 2D coord, used to match endpoint points by
 * position rather than entity id. Tolerance 0.005mm — well inside
 * any sketch-editor snap radius (>= 1 unit) but tight enough not
 * to collapse genuinely-separate vertices. */
function vertexKeyOf(pt: Pt): string {
  const TOL = 0.005;
  return `${Math.round(pt.x / TOL)},${Math.round(pt.y / TOL)}`;
}

/** Endpoint coord keys for a line/arc — both endpoints, canonicalized
 * via `vertexKeyOf`. Empty for entities without endpoints (circle,
 * ellipse, point, spline). */
function endpointKeysOf(state: SketchState, e: SketchEntity): string[] {
  if (e.kind !== 'line' && e.kind !== 'arc') return [];
  const a = findPoint(state, e.startId);
  const b = findPoint(state, e.endId);
  const out: string[] = [];
  if (a) out.push(vertexKeyOf(a));
  if (b) out.push(vertexKeyOf(b));
  return out;
}

export function offsetCurve(
  state: SketchState, entityId: string, distance: number, sidePoint: Pt,
): OpResult {
  const e = findEntity(state, entityId);
  if (!e) return { state, error: 'Entity not found' };
  // Construction geometry is allowed as an offset source — SolidWorks
  // permits it and it's useful for laying out reference frames.
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
// Chained offset with SolidWorks-style corner handling
// ────────────────────────────────────────────────────────────────────────────
//
// Independent per-curve `offsetCurve` leaves chained polylines with
// disconnected segments at every corner — each segment offsets purely
// perpendicular to itself, so adjacent offsets don't meet. SolidWorks
// reconciles each corner of a chained offset:
//
//   - CONVEX corner (offsets DIVERGE):  fill the gap with a circular arc
//     centered at the original vertex, radius = offset distance.
//   - CONCAVE corner (offsets OVERLAP): trim both offsets back to their
//     intersection point.
//
// This module implements that reconciliation for chains of LINES.
// Mixed line/arc and arc/arc corners are handled with a fallback
// (intersect-or-leave-gap) since their full reconciliation needs
// line-circle / circle-circle intersection bookkeeping; covers ~90%
// of real chains (rectangles, polylines) cleanly.

export interface OffsetChainItem { entityId: string; sidePoint: Pt; }
export interface OffsetChainOptions {
  /** When true, run the offset twice — once with each user-picked
   * sidePoint, once mirrored to the opposite side. */
  bothDirections?: boolean;
  /** When true, fill convex corners with an arc (SW default). When
   * false, extend the two adjacent offsets to meet at a sharp point. */
  fillCorners?: boolean;
  /** When true, add geometric + dimensional constraints linking each
   * offset back to its source so a fully-constrained source produces
   * a fully-constrained offset. SolidWorks-style. */
  linkToOriginals?: boolean;
}

/** Group queued items into chains (connected via shared endpoint
 * coordinates) and order each chain. Returns one list per chain.
 * Matches endpoints by COORDINATE position, not point id — real
 * polylines drawn segment-by-segment use coincidence-constrained
 * separate point ids per endpoint. */
function groupAndOrderChains(state: SketchState, items: OffsetChainItem[]): OffsetChainItem[][] {
  const byId = new Map(items.map(i => [i.entityId, i]));
  const ids = new Set(items.map(i => i.entityId));
  // vertex coord key → entity ids in the queue using it.
  const vertexMap = new Map<string, string[]>();
  for (const id of ids) {
    const e = findEntity(state, id);
    if (!e) continue;
    for (const k of endpointKeysOf(state, e)) {
      const list = vertexMap.get(k) ?? [];
      list.push(id);
      vertexMap.set(k, list);
    }
  }
  // BFS-flood the queue into connected components by coord match.
  const visited = new Set<string>();
  const chains: OffsetChainItem[][] = [];
  for (const startId of ids) {
    if (visited.has(startId)) continue;
    const component: string[] = [];
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      const e = findEntity(state, id);
      if (!e) continue;
      for (const k of endpointKeysOf(state, e)) {
        for (const other of vertexMap.get(k) ?? []) {
          if (!visited.has(other)) queue.push(other);
        }
      }
    }
    if (component.length === 1) {
      chains.push([byId.get(component[0])!]);
      continue;
    }
    // Order the component: find a "chain end" (coord used by exactly
    // one component entity) and walk from there. Closed loops have
    // no such coord — start anywhere.
    const idSet = new Set(component);
    let startEntity: string | null = null;
    let startKey: string | null = null;
    outer: for (const id of component) {
      const e = findEntity(state, id);
      if (!e) continue;
      for (const k of endpointKeysOf(state, e)) {
        const usedBy = (vertexMap.get(k) ?? []).filter(eid => idSet.has(eid));
        if (usedBy.length === 1) { startEntity = id; startKey = k; break outer; }
      }
    }
    if (!startEntity) { startEntity = component[0]; startKey = null; }
    const ordered: string[] = [startEntity];
    const seen = new Set<string>([startEntity]);
    let prevKey: string | null = startKey;
    while (true) {
      const last = ordered[ordered.length - 1];
      const e = findEntity(state, last);
      if (!e) break;
      const eps = endpointKeysOf(state, e);
      // Pick the coord of `last` that ISN'T the one we entered from
      // — the "outgoing" end of the segment.
      const outK = eps.find(k => k !== prevKey) ?? eps[0];
      let next: string | null = null;
      for (const other of vertexMap.get(outK) ?? []) {
        if (seen.has(other) || !idSet.has(other)) continue;
        next = other; break;
      }
      if (!next) break;
      ordered.push(next);
      seen.add(next);
      prevKey = outK;
    }
    chains.push(ordered.map(id => byId.get(id)!));
  }
  return chains;
}

/** Reflect a sidePoint across the curve so the next offset goes the
 * opposite way. Used by `bothDirections` AND by the Flip-side
 * sidebar action that lets the user toggle the offset direction
 * after queuing without re-clicking. */
export function flipSidePoint(state: SketchState, entityId: string, sidePoint: Pt): Pt {
  const e = findEntity(state, entityId);
  if (!e) return sidePoint;
  if (e.kind === 'line') {
    const a = findPoint(state, e.startId);
    const b = findPoint(state, e.endId);
    if (!a || !b) return sidePoint;
    return reflectAcrossLine(sidePoint, a, b);
  }
  if (e.kind === 'circle' || e.kind === 'arc') {
    const c = findPoint(state, e.centerId);
    if (!c) return sidePoint;
    const d = Math.hypot(sidePoint.x - c.x, sidePoint.y - c.y);
    // Outside → flip to inside (center is a safe inside point).
    // Inside  → flip to outside (extend through center past the edge).
    if (d > e.radius) return { x: c.x, y: c.y };
    const ux = sidePoint.x - c.x, uy = sidePoint.y - c.y;
    if (d < EPS) return { x: c.x + e.radius * 2, y: c.y };
    const s = (e.radius * 2) / d;
    return { x: c.x + ux * s, y: c.y + uy * s };
  }
  return sidePoint;
}

/** For closed chains, build a tessellated polygon from the SOURCE
 * curves (arcs subdivided into N chord segments) and test whether
 * each new offset entity's midpoint lies inside it. Items whose
 * side disagrees with the seed item's side are marked for flip.
 *
 * The seed item is the chain's representative of `allItems[0]` if
 * present; otherwise the chain's first item. Open chains return
 * all-false (this check doesn't apply).
 */
function detectOffsetsOnWrongPolygonSide(
  state: SketchState,
  preState: SketchState,
  workItems: OffsetChainItem[],
  offsetIds: string[],
  allItems: OffsetChainItem[],
): boolean[] {
  const out = new Array<boolean>(workItems.length).fill(false);
  if (workItems.length < 3) return out;
  const polygon = tessellateChainPolygon(preState, workItems);
  if (!polygon) return out;
  // Identify the seed within this chain — the earliest entry in
  // `allItems` that's present in this chain (preserves user-click
  // semantics: the first-clicked entity's side is authoritative).
  const workIds = new Set(workItems.map(it => it.entityId));
  let seedIdx = -1;
  for (const it of allItems) {
    if (workIds.has(it.entityId)) {
      seedIdx = workItems.findIndex(wi => wi.entityId === it.entityId);
      break;
    }
  }
  if (seedIdx < 0) seedIdx = 0;
  const sides: (boolean | null)[] = workItems.map((_, i) => {
    const oid = offsetIds[i];
    if (!oid) return null;
    const off = findEntity(state, oid);
    if (!off) return null;
    const mid = offsetMidpoint(state, off);
    if (!mid) return null;
    return _polygonContains(polygon, mid);
  });
  const seedSide = sides[seedIdx];
  if (seedSide == null) return out;
  for (let i = 0; i < workItems.length; i++) {
    if (i === seedIdx) continue;
    const s = sides[i];
    if (s == null) continue;
    if (s !== seedSide) out[i] = true;
  }
  return out;
}

/** Walk an ordered chain of line/arc entities and emit a tessellated
 * polygon — lines contribute their entry endpoint, arcs contribute
 * their entry endpoint plus N-1 intermediate samples along the
 * stored sweep direction. Returns null if the chain isn't a closed
 * loop of line/arc entities. */
function tessellateChainPolygon(state: SketchState, chain: OffsetChainItem[]): Pt[] | null {
  if (chain.length < 2) return null;
  const N = 16;
  type Info = { startPt: Pt; endPt: Pt };
  const info = new Map<string, Info>();
  for (const item of chain) {
    const e = findEntity(state, item.entityId);
    if (!e || (e.kind !== 'line' && e.kind !== 'arc')) return null;
    const sp = findPoint(state, e.startId);
    const ep = findPoint(state, e.endId);
    if (!sp || !ep) return null;
    info.set(item.entityId, { startPt: { x: sp.x, y: sp.y }, endPt: { x: ep.x, y: ep.y } });
  }
  const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  const first = info.get(chain[0].entityId)!;
  const last = info.get(chain[chain.length - 1].entityId)!;
  const isClosed = same(first.startPt, last.startPt) || same(first.startPt, last.endPt) ||
                   same(first.endPt, last.startPt) || same(first.endPt, last.endPt);
  if (!isClosed) return null;
  // First entity's entry endpoint = whichever matches last entity.
  let entryPt: Pt = (same(first.startPt, last.startPt) || same(first.startPt, last.endPt))
    ? first.startPt : first.endPt;
  const polygon: Pt[] = [];
  for (let i = 0; i < chain.length; i++) {
    const e = findEntity(state, chain[i].entityId);
    if (!e) return null;
    const ii = info.get(chain[i].entityId)!;
    const entryIsStart = same(entryPt, ii.startPt);
    const exitPt = entryIsStart ? ii.endPt : ii.startPt;
    polygon.push(entryPt);
    if (e.kind === 'arc') {
      const c = findPoint(state, e.centerId);
      if (c) {
        const entryAngle = Math.atan2(entryPt.y - c.y, entryPt.x - c.x);
        const exitAngle = Math.atan2(exitPt.y - c.y, exitPt.x - c.x);
        const sweepCcw = entryIsStart ? e.ccw : !e.ccw;
        let sweep = exitAngle - entryAngle;
        const TAU = Math.PI * 2;
        if (sweepCcw) { while (sweep <= 0) sweep += TAU; }
        else { while (sweep >= 0) sweep -= TAU; }
        for (let k = 1; k < N; k++) {
          const t = k / N;
          const a = entryAngle + sweep * t;
          polygon.push({ x: c.x + e.radius * Math.cos(a), y: c.y + e.radius * Math.sin(a) });
        }
      }
    }
    entryPt = exitPt;
  }
  return polygon;
}

/** Midpoint of an entity, used as a representative interior sample
 * for polygon containment tests. For lines, the chord midpoint; for
 * arcs, the point at the sweep midpoint; for circles, any point on
 * the circumference (the rightmost). */
function offsetMidpoint(state: SketchState, e: SketchEntity): Pt | null {
  if (e.kind === 'line') {
    const a = findPoint(state, e.startId);
    const b = findPoint(state, e.endId);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (e.kind === 'arc') {
    const c = findPoint(state, e.centerId);
    const sp = findPoint(state, e.startId);
    const ep = findPoint(state, e.endId);
    if (!c || !sp || !ep) return null;
    const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
    const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
    const TAU = Math.PI * 2;
    let sweep = ea - sa;
    if (e.ccw) { while (sweep <= 0) sweep += TAU; }
    else { while (sweep >= 0) sweep -= TAU; }
    const ma = sa + sweep / 2;
    return { x: c.x + e.radius * Math.cos(ma), y: c.y + e.radius * Math.sin(ma) };
  }
  if (e.kind === 'circle') {
    const c = findPoint(state, e.centerId);
    if (!c) return null;
    return { x: c.x + e.radius, y: c.y };
  }
  return null;
}

/** For each item in `workItems`, return true if its computed offset
 * (`offsetIds[i]`) crosses any source curve in `allItems` other than
 * its own source. "Crosses" means an interior–interior intersection
 * (endpoint touches don't count). Used for auto-flip in chain offset. */
function detectOffsetsCrossingSources(
  state: SketchState,
  workItems: OffsetChainItem[],
  offsetIds: string[],
  allItems: OffsetChainItem[],
): boolean[] {
  const result = new Array<boolean>(workItems.length).fill(false);
  for (let i = 0; i < workItems.length; i++) {
    const oid = offsetIds[i];
    if (!oid) continue;
    const off = findEntity(state, oid);
    if (!off) continue;
    for (const src of allItems) {
      if (src.entityId === workItems[i].entityId) continue;
      const se = findEntity(state, src.entityId);
      if (!se) continue;
      if (curvesCrossInteriors(state, off, se)) { result[i] = true; break; }
    }
  }
  return result;
}

/** True when two curves (line/arc/circle) cross at a point strictly
 * inside BOTH — endpoint touches and tangents are excluded. Strict
 * interior is required because chained offsets share endpoints with
 * adjacent source curves at corners; those shared points would
 * trigger false positives. */
function curvesCrossInteriors(
  state: SketchState, a: SketchEntity, b: SketchEntity,
): boolean {
  const EPS_T = 1e-6;
  const TAU = 2 * Math.PI;
  const angDiff = (x: number, y: number) => {
    let d = ((x - y) % TAU + TAU) % TAU;
    if (d > Math.PI) d = TAU - d;
    return d;
  };
  const angleStrictlyInArc = (
    h: Pt, c: Pt, sPt: Pt, ePt: Pt, ccw: boolean,
  ): boolean => {
    const ha = Math.atan2(h.y - c.y, h.x - c.x);
    const sa = Math.atan2(sPt.y - c.y, sPt.x - c.x);
    const ea = Math.atan2(ePt.y - c.y, ePt.x - c.x);
    if (!angleInArcSweep(ha, sa, ea, ccw)) return false;
    return angDiff(ha, sa) > EPS_T && angDiff(ha, ea) > EPS_T;
  };
  const tAlongLine = (p: Pt, l1: Pt, l2: Pt): number => {
    const dx = l2.x - l1.x, dy = l2.y - l1.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return -1;
    return ((p.x - l1.x) * dx + (p.y - l1.y) * dy) / len2;
  };
  const lineInterior = (t: number) => t > EPS_T && t < 1 - EPS_T;

  if (a.kind === 'line' && b.kind === 'line') {
    const a1 = findPoint(state, a.startId), a2 = findPoint(state, a.endId);
    const b1 = findPoint(state, b.startId), b2 = findPoint(state, b.endId);
    if (!a1 || !a2 || !b1 || !b2) return false;
    const hit = lineLineIntersection(a1, a2, b1, b2);
    if (!hit) return false;
    return lineInterior(hit.t1) && lineInterior(hit.t2);
  }
  const lineEnt = a.kind === 'line' ? a : (b.kind === 'line' ? b : null);
  const curveEnt = a.kind === 'line' ? b : (b.kind === 'line' ? a : null);
  if (lineEnt && curveEnt && (curveEnt.kind === 'arc' || curveEnt.kind === 'circle')) {
    const l1 = findPoint(state, lineEnt.startId), l2 = findPoint(state, lineEnt.endId);
    const c = findPoint(state, curveEnt.centerId);
    if (!l1 || !l2 || !c) return false;
    const hits = lineCircleIntersection(l1, l2, c, curveEnt.radius);
    for (const h of hits) {
      const t = tAlongLine(h, l1, l2);
      if (!lineInterior(t)) continue;
      if (curveEnt.kind === 'circle') return true;
      const sPt = findPoint(state, curveEnt.startId);
      const ePt = findPoint(state, curveEnt.endId);
      if (!sPt || !ePt) continue;
      if (angleStrictlyInArc(h, c, sPt, ePt, curveEnt.ccw)) return true;
    }
    return false;
  }
  if ((a.kind === 'arc' || a.kind === 'circle') && (b.kind === 'arc' || b.kind === 'circle')) {
    const ca = findPoint(state, a.centerId), cb = findPoint(state, b.centerId);
    if (!ca || !cb) return false;
    const hits = circleCircleIntersection(ca, a.radius, cb, b.radius);
    for (const h of hits) {
      if (a.kind === 'arc') {
        const sPt = findPoint(state, a.startId), ePt = findPoint(state, a.endId);
        if (!sPt || !ePt || !angleStrictlyInArc(h, ca, sPt, ePt, a.ccw)) continue;
      }
      if (b.kind === 'arc') {
        const sPt = findPoint(state, b.startId), ePt = findPoint(state, b.endId);
        if (!sPt || !ePt || !angleStrictlyInArc(h, cb, sPt, ePt, b.ccw)) continue;
      }
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Chained offset. Walks the queue into one or more chains, runs
 * `offsetCurve` per item, then reconciles each interior corner so
 * adjacent offsets meet cleanly. Returns the new state + all new
 * entity ids (including arc fillers added at convex corners).
 */
export function offsetChain(
  state: SketchState, items: OffsetChainItem[], distance: number,
  opts: OffsetChainOptions = {},
): OpResult {
  if (items.length === 0) return { state, error: 'No curves to offset' };
  if (distance <= EPS) return { state, error: 'Offset distance must be positive' };
  let s = state;
  const allNew: string[] = [];
  const passes: OffsetChainItem[][] = opts.bothDirections
    ? [items, items.map(it => ({ ...it, sidePoint: flipSidePoint(state, it.entityId, it.sidePoint) }))]
    : [items];
  for (const passItems of passes) {
    const chains = groupAndOrderChains(s, passItems);
    let chainIdx = 0;
    for (const chain of chains) {
      // Step 1 — per-item offset. Each yields a new entity id; we
      // accumulate them so the corner pass can mutate.
      // Auto-flip: if any new offset crosses a source curve (other
      // than its own source), redo with the offending items' sides
      // flipped. `offsetCurve` for arcs decides outward/inward by
      // distance-to-center, which can disagree with the user's
      // polygon-interior intent when the click is on the "wrong
      // side" of an arc's circle — this catches that. Skipped for
      // bothDirections (the user explicitly wants both sides).
      let workItems = chain;
      let offsetIds: string[] = [];
      const stateBeforeChain = s;
      const maxAttempts = opts.bothDirections ? 1 : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        s = stateBeforeChain;
        offsetIds = [];
        for (const item of workItems) {
          const r = offsetCurve(s, item.entityId, distance, item.sidePoint);
          if (r.error || !r.affectedIds || r.affectedIds.length === 0) {
            console.warn('offsetChain: offsetCurve failed for', item.entityId, r.error);
            offsetIds.push('');  // placeholder so chain indices stay aligned
            continue;
          }
          s = r.state;
          offsetIds.push(r.affectedIds[0]);
        }
        if (attempt + 1 >= maxAttempts) break;
        // Combine two consistency checks. Cross-detection catches
        // offsets that crossed a source curve (e.g. an arc offset
        // that swept into another part of the polygon). Polygon-side
        // detection catches the subtler case where the chain has
        // mixed inward/outward offsets without any crossing — closed
        // chains only, where the seed item's side is ground truth.
        const crossFlip = detectOffsetsCrossingSources(s, workItems, offsetIds, items);
        const polyFlip = detectOffsetsOnWrongPolygonSide(s, stateBeforeChain, workItems, offsetIds, items);
        const needFlip = workItems.map((_, i) => crossFlip[i] || polyFlip[i]);
        if (!needFlip.some(x => x)) break;
        workItems = workItems.map((it, i) => needFlip[i]
          ? { ...it, sidePoint: flipSidePoint(stateBeforeChain, it.entityId, it.sidePoint) }
          : it);
      }
      for (const id of offsetIds) if (id) allNew.push(id);
      // Step 2 — reconcile adjacent offset pairs at each corner.
      // Single-entity chains have no corners; skip. For closed
      // loops, also reconcile the wrap-around pair (last, first).
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i + 1 < chain.length; i++) pairs.push([i, i + 1]);
      if (chain.length >= 3) {
        const firstE = findEntity(s, chain[0].entityId);
        const lastE = findEntity(s, chain[chain.length - 1].entityId);
        if (firstE && lastE && sharedEndpointBetween(s, lastE, firstE)) {
          pairs.push([chain.length - 1, 0]);
        }
      }
      for (const [i, j] of pairs) {
        const aOrig = findEntity(s, chain[i].entityId);
        const bOrig = findEntity(s, chain[j].entityId);
        if (!aOrig || !bOrig) continue;
        const aOff = offsetIds[i] ? findEntity(s, offsetIds[i]) : null;
        const bOff = offsetIds[j] ? findEntity(s, offsetIds[j]) : null;
        if (!aOff || !bOff) continue;
        // Only line/arc entities have endpoints — circles can't
        // participate in chain corners (they have no shared
        // vertex with another curve). Skip if either is a circle.
        if ((aOrig.kind !== 'line' && aOrig.kind !== 'arc') ||
            (bOrig.kind !== 'line' && bOrig.kind !== 'arc')) continue;
        if ((aOff.kind !== 'line' && aOff.kind !== 'arc') ||
            (bOff.kind !== 'line' && bOff.kind !== 'arc')) continue;
        const res = reconcileCorner(s, aOrig, bOrig, aOff, bOff, distance, !!opts.fillCorners);
        if (res.state !== s) s = res.state;
        if (res.newArcId) allNew.push(res.newArcId);
      }
      // Step 3 — link offsets back to their originals so a fully-
      // constrained source produces a fully-constrained offset.
      // Skipped for `bothDirections` to avoid double-constraining
      // (the second pass's offsets would conflict with the first's
      // identical dimensions).
      if (opts.linkToOriginals && !opts.bothDirections) {
        s = linkOffsetsToOriginals(s, chain, offsetIds, distance, chainIdx === 0);
      }
      chainIdx++;
    }
  }
  return { state: s, affectedIds: allNew };
}

/** Dispatch — single-item chains get the FULL single-offset
 * constraint set. Multi-item chains get per-segment parallel +
 * perpendicular-distance dim, plus a perpendicular construction
 * line at each open chain end (so off.startId / off.endId of the
 * outermost segments are pinned to the perpendicular foot of their
 * matching source endpoints). Corner endpoints between adjacent
 * segments are coincident-pinned in reconcileCorner.
 *
 * For N-segment chains this gives 4N residuals on 4N free DOFs →
 * fully determined (for open chains). For closed loops the chain
 * ends connect via a corner instead, so the perp lines aren't
 * added (the corner coincidents take their place). */
function linkOffsetsToOriginals(
  state: SketchState,
  chain: OffsetChainItem[],
  offsetIds: string[],
  distance: number,
  isFirstChain: boolean,
): SketchState {
  let s = state;
  if (chain.length === 1) {
    const orig = findEntity(s, chain[0].entityId);
    const off = offsetIds[0] ? findEntity(s, offsetIds[0]) : null;
    if (orig && off) s = linkSingleOffset(s, orig, off, distance, chain[0].sidePoint);
    return s;
  }
  void isFirstChain;  // chain-level handling no longer differs per chain
  // Per-segment: parallel + corner coincidents propagate the offset
  // distance through the chain GEOMETRICALLY, but PlaneGCS counts
  // constraints rather than reasoning about geometry, so we emit a
  // point-line-distance for EVERY segment to give the solver enough
  // equations to mark the offset as fully constrained. Only the
  // FIRST has a `placement` (visible dim label); the rest are
  // tagged with a shared `chainId` so the UI hides them as
  // chain-internal duplicates and a dim-value edit propagates to
  // every constraint in the group.
  // Result: a 3-line offset shows ONE dim, but the solver sees
  // every distance equation it needs — matching SolidWorks' "single
  // visible dimension, fully constrained" behaviour.
  const chainId = `offset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let firstVisibleDimEmitted = false;
  for (let i = 0; i < chain.length; i++) {
    const offId = offsetIds[i];
    if (!offId) continue;
    const orig = findEntity(s, chain[i].entityId);
    const off  = findEntity(s, offId);
    if (!orig || !off) continue;
    // Show only ONE dim per chain — the first line's perpendicular
    // offset distance. Arc radii are derived from the source arc's
    // radius plus/minus this distance, so the chain-dim propagation
    // (in the editor's onDimensionEdited) updates them whenever the
    // visible dim changes. Hiding the radius dim keeps the sketch
    // visually clean (matches SolidWorks: one dim per offset chain).
    const isLine = orig.kind === 'line';
    const showDim = isLine && !firstVisibleDimEmitted;
    s = linkChainOffset(s, orig, off, distance, chain[i].sidePoint, true /* includeDim */, showDim, chainId);
    if (isLine && showDim) firstVisibleDimEmitted = true;
  }
  // Chain-end pins (open chains only — closed loops use the corner
  // coincident from reconcileCorner at the wrap-around).
  s = linkChainEndPins(s, chain, offsetIds, distance);
  return s;
}

/** Add a perpendicular construction line at each chain-end outward
 * endpoint, pinning the offset's matching endpoint at the
 * perpendicular foot of the source's outward endpoint. Skipped for
 * closed loops (the outward endpoint is shared with the other end
 * of the chain, so the corner-coincident already pins it). */
function linkChainEndPins(
  state: SketchState, chain: OffsetChainItem[], offsetIds: string[], distance: number,
): SketchState {
  if (chain.length < 2) return state;
  let s = state;
  const lastIdx = chain.length - 1;
  // First item's outward endpoint: not the one shared with chain[1].
  const firstOrig = findEntity(s, chain[0].entityId);
  const secondOrig = findEntity(s, chain[1].entityId);
  if (firstOrig && secondOrig) {
    const outward = outwardEndpointId(s, firstOrig, secondOrig);
    // Skip when the outward endpoint also matches the LAST item's
    // endpoint — closed loop.
    const lastOrig = findEntity(s, chain[lastIdx].entityId);
    const isClosed = outward && lastOrig && entityHasEndpointAt(s, lastOrig, outward);
    if (outward && !isClosed && offsetIds[0]) {
      const firstOff = findEntity(s, offsetIds[0]);
      if (firstOff) s = addChainEndPin(s, firstOrig, firstOff, outward, distance);
    }
  }
  // Last item's outward endpoint: not the one shared with chain[N-2].
  const lastOrig = findEntity(s, chain[lastIdx].entityId);
  const prevOrig = findEntity(s, chain[lastIdx - 1].entityId);
  if (lastOrig && prevOrig) {
    const outward = outwardEndpointId(s, lastOrig, prevOrig);
    // For closed loops, this outward endpoint matches the first
    // item's outward → already handled above (and skipped).
    if (outward && offsetIds[lastIdx]) {
      const firstOrigE = findEntity(s, chain[0].entityId);
      const isClosed = firstOrigE && entityHasEndpointAt(s, firstOrigE, outward);
      if (!isClosed) {
        const lastOff = findEntity(s, offsetIds[lastIdx]);
        if (lastOff) s = addChainEndPin(s, lastOrig, lastOff, outward, distance);
      }
    }
  }
  return s;
}

/** Return whichever endpoint id of `e` does NOT share a coord with
 * any endpoint of `neighbor`. Null when entities aren't connected. */
function outwardEndpointId(
  state: SketchState, e: SketchEntity, neighbor: SketchEntity,
): string | null {
  if ((e.kind !== 'line' && e.kind !== 'arc') ||
      (neighbor.kind !== 'line' && neighbor.kind !== 'arc')) return null;
  const eEps = [(e as LineEntity | ArcEntity).startId, (e as LineEntity | ArcEntity).endId];
  const nEps = [(neighbor as LineEntity | ArcEntity).startId, (neighbor as LineEntity | ArcEntity).endId];
  const nKeys = new Set<string>();
  for (const nid of nEps) {
    const npt = findPoint(state, nid);
    if (npt) nKeys.add(vertexKeyOf(npt));
  }
  for (const eid of eEps) {
    const ept = findPoint(state, eid);
    if (!ept) continue;
    if (!nKeys.has(vertexKeyOf(ept))) return eid;
  }
  return null;
}

/** True if `entity` has an endpoint at the same coord as the point
 * identified by `pointId`. Used to detect closed loops. */
function entityHasEndpointAt(state: SketchState, entity: SketchEntity, pointId: string): boolean {
  if (entity.kind !== 'line' && entity.kind !== 'arc') return false;
  const targetPt = findPoint(state, pointId);
  if (!targetPt) return false;
  const targetKey = vertexKeyOf(targetPt);
  const eEps = [(entity as LineEntity | ArcEntity).startId, (entity as LineEntity | ArcEntity).endId];
  for (const id of eEps) {
    const pt = findPoint(state, id);
    if (pt && vertexKeyOf(pt) === targetKey) return true;
  }
  return false;
}

/** Add a chain-end perpendicular / radial construction line + the
 * constraint that pins the offset's outward endpoint. Lines use
 * perpendicular(source, cl); arcs use coincident(off-endpoint,
 * radial). */
function addChainEndPin(
  state: SketchState, orig: SketchEntity, off: SketchEntity,
  outwardOrigId: string, distance: number,
): SketchState {
  void distance;
  let s = state;
  if (orig.kind === 'line' && off.kind === 'line') {
    const outwardOffId = orig.startId === outwardOrigId ? off.startId : off.endId;
    const cl = addLine(s, outwardOrigId, outwardOffId, { construction: true });
    s = cl.state;
    s = addConstraint(s, 'perpendicular', [orig.id, cl.id]).state;
    return s;
  }
  if (orig.kind === 'arc' && off.kind === 'arc') {
    const outwardOffId = orig.startId === outwardOrigId ? off.startId : off.endId;
    const rad = addLine(s, orig.centerId, outwardOrigId, { construction: true });
    s = rad.state;
    s = addConstraint(s, 'coincident', [outwardOffId, rad.id]).state;
    return s;
  }
  return s;
}

/** Single-item offset: full constraint set.
 *   Line   → parallel + equal length + perpendicular construction
 *            line + point-line-distance dim. 4 constraints, 4 DOFs
 *            killed (verified by solver spec). Adding a SECOND
 *            perpendicular construction line over-constrains the
 *            system per PlaneGCS's redundancy detection; one is
 *            enough because parallel + equal + 1-perp implies the
 *            opposite endpoint sits at the matching perpendicular
 *            foot.
 *   Circle → concentric + radius dim. 3 DOFs killed → fully
 *            constrained.
 *   Arc    → concentric + radius dim + 2 radial construction
 *            lines + 2 coincident constraints (point-on-line, one
 *            per arc endpoint). Pins center, radius, AND the
 *            angular positions of the offset's start/end. */
function linkSingleOffset(
  state: SketchState, orig: SketchEntity, off: SketchEntity, distance: number, sidePoint: Pt,
): SketchState {
  if (orig.kind === 'line' && off.kind === 'line') {
    let s = state;
    s = addConstraint(s, 'parallel', [orig.id, off.id]).state;
    s = addConstraint(s, 'equal',    [orig.id, off.id]).state;
    // Perpendicular construction line pins off.startId at the
    // perpendicular foot of orig.startId. With parallel + equal
    // length, the opposite endpoint (off.endId) is implicitly at
    // orig.endId's perpendicular foot.
    const cl = addLine(s, orig.startId, off.startId, { construction: true });
    s = cl.state;
    s = addConstraint(s, 'perpendicular', [orig.id, cl.id]).state;
    // The driving dimension: perpendicular distance from
    // orig.startId to the offset line. Double-click the label to
    // edit; the offset re-solves at the new distance.
    const placement = lineDimPlacement(s, orig, sidePoint, distance);
    s = addConstraint(s, 'point-line-distance', [orig.startId, off.id], distance, placement).state;
    return s;
  }
  if ((orig.kind === 'circle' && off.kind === 'circle') ||
      (orig.kind === 'arc'    && off.kind === 'arc')) {
    let s = state;
    s = addConstraint(s, 'concentric', [orig.id, off.id]).state;
    const placement = circleDimPlacement(s, orig as CircleEntity | ArcEntity, sidePoint);
    s = addConstraint(s, 'radius', [off.id], (off as CircleEntity | ArcEntity).radius, placement).state;
    // For arcs the start / end angles still need pinning — add a
    // radial construction line per endpoint so each offset endpoint
    // stays coincident with the radial through the source's
    // matching endpoint.
    if (orig.kind === 'arc' && off.kind === 'arc') {
      const rad1 = addLine(s, orig.centerId, orig.startId, { construction: true });
      s = rad1.state;
      s = addConstraint(s, 'coincident', [off.startId, rad1.id]).state;
      const rad2 = addLine(s, orig.centerId, orig.endId, { construction: true });
      s = rad2.state;
      s = addConstraint(s, 'coincident', [off.endId, rad2.id]).state;
    }
    return s;
  }
  return state;
}

/** Chain-item offset: parallel / concentric direction constraint
 * + a perpendicular-distance dim per segment. Every segment gets
 * its own dim so its perp distance from the source is pinned;
 * combined with corner coincidents (from reconcileCorner) and
 * chain-end perp construction lines (from linkChainEndPins) this
 * makes open chains fully constrained. */
function linkChainOffset(
  state: SketchState, orig: SketchEntity, off: SketchEntity, distance: number, sidePoint: Pt,
  includeDim: boolean,
  showDim: boolean = true,
  chainId?: string,
): SketchState {
  let s = state;
  // Helper: tag a freshly-added constraint with the chain group id so
  // the UI can treat the batch as one logical offset operation.
  const tagLastConstraintWithChainId = (st: SketchState): SketchState => {
    if (!chainId) return st;
    const last = st.constraints[st.constraints.length - 1];
    if (!last) return st;
    return {
      ...st,
      constraints: [
        ...st.constraints.slice(0, -1),
        { ...last, chainId },
      ],
    };
  };
  if (orig.kind === 'line' && off.kind === 'line') {
    s = addConstraint(s, 'parallel', [orig.id, off.id]).state;
    s = tagLastConstraintWithChainId(s);
    if (includeDim) {
      // showDim controls whether this dim gets a `placement` (rendered
      // as a visible label) — every chain segment emits the constraint
      // so the solver has enough equations to mark the offset as fully
      // constrained, but only ONE renders to the user.
      const placement = showDim ? lineDimPlacement(s, orig, sidePoint, distance) : undefined;
      s = addConstraint(s, 'point-line-distance', [orig.startId, off.id], distance, placement).state;
      s = tagLastConstraintWithChainId(s);
    }
    return s;
  }
  if ((orig.kind === 'circle' && off.kind === 'circle') ||
      (orig.kind === 'arc'    && off.kind === 'arc')) {
    s = addConstraint(s, 'concentric', [orig.id, off.id]).state;
    s = tagLastConstraintWithChainId(s);
    const placement = showDim ? circleDimPlacement(s, orig as CircleEntity | ArcEntity, sidePoint) : undefined;
    s = addConstraint(s, 'radius', [off.id], (off as CircleEntity | ArcEntity).radius, placement).state;
    s = tagLastConstraintWithChainId(s);
    return s;
  }
  return s;
}

/** Compute a sensible placement for the line offset's dim label:
 * midpoint of the source line, then offset perpendicular toward
 * the user's sidePoint click by `distance` so the label sits
 * roughly ON the offset line where the user is looking. */
function lineDimPlacement(
  state: SketchState, orig: SketchEntity, sidePoint: Pt, distance: number,
): { x: number; y: number } | undefined {
  if (orig.kind !== 'line') return undefined;
  const a = findPoint(state, orig.startId);
  const b = findPoint(state, orig.endId);
  if (!a || !b) return undefined;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return undefined;
  const nx = -dy / len, ny = dx / len;
  const sign = (sidePoint.x - midX) * nx + (sidePoint.y - midY) * ny >= 0 ? 1 : -1;
  return { x: midX + nx * distance * sign, y: midY + ny * distance * sign };
}

/** Compute a sensible placement for the circle/arc radius label:
 * along the line from center toward the user's sidePoint click,
 * out at 1.2× the source radius so it doesn't overlap the curve. */
function circleDimPlacement(
  state: SketchState, orig: CircleEntity | ArcEntity, sidePoint: Pt,
): { x: number; y: number } | undefined {
  const c = findPoint(state, orig.centerId);
  if (!c) return undefined;
  const dx = sidePoint.x - c.x, dy = sidePoint.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return undefined;
  const ux = dx / len, uy = dy / len;
  return { x: c.x + ux * orig.radius * 1.2, y: c.y + uy * orig.radius * 1.2 };
}

/** Generic corner reconciler. Handles every line/arc combination by:
 *   1. Finding the shared original vertex V between the two source
 *      curves.
 *   2. Locating each OFFSET's near-V endpoint (the offset preserves
 *      start/end parity from the original, so the near-V end is
 *      whichever corresponds to V).
 *   3. Intersecting the offsets' underlying geometries — lineLineIntersection
 *      for line+line, lineCircleIntersection for line+arc, circleCircleIntersection
 *      for arc+arc — and picking the candidate closest to both near-V
 *      endpoints.
 *   4. Checking whether that intersection lies in the angular wedge
 *      between (V→nearA) and (V→nearB). If it does, the corner is
 *      CONCAVE — trim both near-V endpoints to the intersection. If
 *      it doesn't, the corner is CONVEX — when `fillCorners`, drop in
 *      an arc filler centered at V (radius = offset distance); else
 *      sharp-extend both endpoints to the intersection (a "miter"). */
function reconcileCorner(
  state: SketchState,
  aOrig: SketchEntity, bOrig: SketchEntity,
  aOff: SketchEntity, bOff: SketchEntity,
  distance: number, fillCorners: boolean,
): { state: SketchState; newArcId?: string } {
  const shared = sharedEndpointBetween(state, aOrig, bOrig);
  if (!shared) return { state };
  const { V, aOrigEndpointId, bOrigEndpointId } = shared;
  const aNear = nearOffsetEndpoint(state, aOrig, aOff, aOrigEndpointId);
  const bNear = nearOffsetEndpoint(state, bOrig, bOff, bOrigEndpointId);
  if (!aNear || !bNear) return { state };

  // Tangent-corner shortcut: when the line/arc are tangent at the
  // source vertex, their offsets meet exactly at one point — both
  // near endpoints land on top of each other (gap ≈ 0). The
  // convex/concave analysis below would otherwise mis-classify
  // these near-zero gaps as a tiny convex corner due to
  // floating-point noise, generating a zero-length filler arc.
  // Skip straight to pinning the two near endpoints together.
  const gap0 = Math.hypot(aNear.pt.x - bNear.pt.x, aNear.pt.y - bNear.pt.y);
  const gapTol = Math.max(1e-6, distance * 1e-2);
  if (gap0 < gapTol) {
    let s = state;
    const avg = { x: (aNear.pt.x + bNear.pt.x) / 2, y: (aNear.pt.y + bNear.pt.y) / 2 };
    s = movePointTo(s, aNear.id, avg);
    s = mergePoints(s, aNear.id, bNear.id);
    // Tangent line-arc corners have a slide-DOF the linear analyzer
    // can't pin: both the arc-invariant gradient and the line's
    // perp-distance gradient align along the same axis at the tangent
    // point, so the corner's coord along the tangent direction has no
    // first-order constraint (even though it's globally unique).
    // Anchor that DOF with a construction line from the SOURCE corner
    // (a pinned anchor point) to the merged offset corner, then
    // constrain it horizontal or vertical to match the source line's
    // perpendicular axis. Adds a clean axially-aligned gradient on
    // the previously-unpinned coord.
    const lineOrig = aOrig.kind === 'line' ? aOrig : (bOrig.kind === 'line' ? bOrig : null);
    const arcOrig = aOrig.kind === 'arc' ? aOrig : (bOrig.kind === 'arc' ? bOrig : null);
    if (lineOrig && arcOrig) {
      const srcCornerId = aOrig === lineOrig ? aOrigEndpointId : bOrigEndpointId;
      const ls = findPoint(s, lineOrig.startId);
      const le = findPoint(s, lineOrig.endId);
      if (ls && le) {
        const dx = le.x - ls.x;
        const dy = le.y - ls.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const isHoriz = absDy < absDx * 0.01;
        const isVert = absDx < absDy * 0.01;
        if (isHoriz || isVert) {
          const ln = addLine(s, srcCornerId, aNear.id, { construction: true });
          s = ln.state;
          // Source line horizontal → construction line is vertical
          // (joins source/offset corners along the perpendicular).
          s = addConstraint(s, isHoriz ? 'vertical' : 'horizontal', [ln.id]).state;
        }
      }
    }
    return { state: s };
  }

  // Collect every intersection candidate between the offsets'
  // underlying infinite geometries (full line for lines, full circle
  // for circles/arcs). Each candidate is a 2D point.
  const candidates = offsetIntersectionCandidates(state, aOff, bOff);
  let best: Pt | null = null;
  if (candidates.length > 0) {
    // Pick the candidate that minimizes the combined distance to both
    // near-V endpoints — that's the one most likely to be the
    // "intended" corner reconciliation point.
    let bestScore = Infinity;
    for (const c of candidates) {
      const score = Math.hypot(c.x - aNear.pt.x, c.y - aNear.pt.y)
                  + Math.hypot(c.x - bNear.pt.x, c.y - bNear.pt.y);
      if (score < bestScore) { best = c; bestScore = score; }
    }
  }

  // No candidate at all (parallel lines, non-intersecting offset
  // circles) → pure convex gap. Either fill or skip.
  if (!best) {
    if (fillCorners) {
      const res = addCornerArc(state, V, aNear, bNear);
      return res;
    }
    return { state };
  }

  // Convex vs concave: parameterize each offset from its FAR-V end
  // (t=0) to its NEAR-V end (t=1). Project `best` onto that
  // parameterization for each offset. If `best` lies PAST the near
  // end on either offset (t > 1), the offsets diverge → CONVEX
  // corner (fill or sharp-miter). If `best` lies inside both
  // [0, 1] ranges, the offsets cross within their original spans →
  // CONCAVE corner (trim back to `best`).
  const aFarPt = farOffsetEndpoint(state, aOrig, aOff, aOrigEndpointId);
  const bFarPt = farOffsetEndpoint(state, bOrig, bOff, bOrigEndpointId);
  if (!aFarPt || !bFarPt) return { state };
  // For arcs: the sweep direction from FAR → NEAR depends on which
  // original endpoint is the shared vertex. arc.ccw stores the
  // start→end direction; if the shared vertex corresponds to START
  // (so far=end, near=start), then far→near reverses arc.ccw.
  const aNearStart = (aOrig as LineEntity | ArcEntity).startId === aOrigEndpointId;
  const bNearStart = (bOrig as LineEntity | ArcEntity).startId === bOrigEndpointId;
  const aSweepCcw  = aOff.kind === 'arc' ? (aNearStart ? !aOff.ccw : aOff.ccw) : true;
  const bSweepCcw  = bOff.kind === 'arc' ? (bNearStart ? !bOff.ccw : bOff.ccw) : true;
  const tA = tAlongOffset(state, aOff, aFarPt, aNear.pt, best, aSweepCcw);
  const tB = tAlongOffset(state, bOff, bFarPt, bNear.pt, best, bSweepCcw);
  const convex = tA > 1 + EPS || tB > 1 + EPS;

  if (!convex) {
    // Concave: both projections inside the segments → offsets cross
    // mid-segment. Trim both near-V endpoints to the intersection,
    // then MERGE the two near-V endpoints into a single shared point
    // (SolidWorks-style corner topology). Merging eliminates two
    // redundant DOFs and removes the analyzer's RREF ambiguity at
    // non-tangent line-arc corners where the arc-invariant's
    // gradient isn't axis-aligned.
    let s = state;
    s = movePointTo(s, aNear.id, best);
    s = mergePoints(s, aNear.id, bNear.id);
    return { state: s };
  }
  if (fillCorners) {
    return addCornerArc(state, V, aNear, bNear);
  }
  // Sharp miter: extend both to the intersection, then merge into a
  // single shared corner point. Same rationale as the concave branch.
  let s = state;
  s = movePointTo(s, aNear.id, best);
  s = mergePoints(s, aNear.id, bNear.id);
  return { state: s };
}

/** Pt of the offset's "far V" endpoint (opposite of the near-V end). */
function farOffsetEndpoint(
  state: SketchState, orig: SketchEntity, off: SketchEntity, origEndpointId: string,
): Pt | null {
  if ((orig.kind !== 'line' && orig.kind !== 'arc') ||
      (off.kind !== 'line' && off.kind !== 'arc')) return null;
  const nearStart = (orig as LineEntity | ArcEntity).startId === origEndpointId;
  const id = nearStart ? (off as LineEntity | ArcEntity).endId : (off as LineEntity | ArcEntity).startId;
  const pt = findPoint(state, id);
  return pt ? { x: pt.x, y: pt.y } : null;
}

/** Parameter t for `query` along the offset entity from `far → near`.
 *   t = 0: query AT far end.
 *   t = 1: query AT near end.
 *   t > 1: query past the near end (extension into the corner gap).
 *   t < 0: query past the far end.
 *
 * For lines: linear projection onto the far→near axis.
 * For arcs : angular sweep position around the arc's center, with
 * the sweep direction matching the arc's ccw flag. */
function tAlongOffset(
  state: SketchState, off: SketchEntity, farEnd: Pt, nearEnd: Pt, query: Pt,
  arcSweepCcw: boolean = true,
): number {
  if (off.kind === 'line') {
    const dx = nearEnd.x - farEnd.x, dy = nearEnd.y - farEnd.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return 0;
    return ((query.x - farEnd.x) * dx + (query.y - farEnd.y) * dy) / len2;
  }
  if (off.kind === 'arc') {
    const c = findPoint(state, off.centerId);
    if (!c) return 0;
    const farA  = Math.atan2(farEnd.y  - c.y, farEnd.x  - c.x);
    const nearA = Math.atan2(nearEnd.y - c.y, nearEnd.x - c.x);
    const qA    = Math.atan2(query.y  - c.y, query.x  - c.x);
    // The sweep direction from far to near isn't necessarily the
    // arc's own ccw flag — see the call site in reconcileCorner.
    const totalSweep   = arcSweepLen(farA, nearA, arcSweepCcw);
    const queryFromFar = arcSweepLen(farA, qA,    arcSweepCcw);
    if (totalSweep < EPS) return 0;
    return queryFromFar / totalSweep;
  }
  return 0;
}

/** Sweep length (radians, always positive) from `fromA` to `toA`
 * going in the CCW direction if `ccw`, CW otherwise. Always returns
 * the value in [0, 2π) — wraps around as needed. */
function arcSweepLen(fromA: number, toA: number, ccw: boolean): number {
  let d = toA - fromA;
  if (ccw) {
    while (d < 0) d += 2 * Math.PI;
    while (d > 2 * Math.PI) d -= 2 * Math.PI;
    return d;
  }
  while (d > 0) d -= 2 * Math.PI;
  while (d < -2 * Math.PI) d += 2 * Math.PI;
  return -d;
}

/** Get the offset's endpoint that corresponds to `origEndpointId`
 * (which is one of the original entity's two endpoint ids). Returns
 * null if the entity isn't a line/arc or the matching point can't
 * be found. Caller is responsible for passing the correct endpoint
 * id — see `sharedEndpointBetween`. */
function nearOffsetEndpoint(
  state: SketchState, orig: SketchEntity, off: SketchEntity, origEndpointId: string,
): { id: string; pt: Pt } | null {
  if ((orig.kind !== 'line' && orig.kind !== 'arc') ||
      (off.kind !== 'line' && off.kind !== 'arc')) return null;
  const nearStart = (orig as LineEntity | ArcEntity).startId === origEndpointId;
  const id = nearStart ? (off as LineEntity | ArcEntity).startId : (off as LineEntity | ArcEntity).endId;
  const pt = findPoint(state, id);
  return pt ? { id, pt: { x: pt.x, y: pt.y } } : null;
}

/** Intersection candidates between two offset entities, treating
 * each as an UNBOUNDED curve (infinite line, full circle) so we
 * don't miss intersections at extensions. Returns 0-2 points. */
function offsetIntersectionCandidates(
  state: SketchState, aOff: SketchEntity, bOff: SketchEntity,
): Pt[] {
  if (aOff.kind === 'line' && bOff.kind === 'line') {
    const a1 = findPoint(state, aOff.startId);
    const a2 = findPoint(state, aOff.endId);
    const b1 = findPoint(state, bOff.startId);
    const b2 = findPoint(state, bOff.endId);
    if (!a1 || !a2 || !b1 || !b2) return [];
    const hit = lineLineIntersection(a1, a2, b1, b2);
    return hit ? [hit.p] : [];
  }
  const asLine = aOff.kind === 'line' ? aOff : (bOff.kind === 'line' ? bOff : null);
  const asArc  = aOff.kind === 'arc'  ? aOff : (bOff.kind === 'arc'  ? bOff : null);
  if (asLine && asArc) {
    const a1 = findPoint(state, asLine.startId);
    const a2 = findPoint(state, asLine.endId);
    const c  = findPoint(state, asArc.centerId);
    if (!a1 || !a2 || !c) return [];
    return lineCircleIntersection(a1, a2, c, asArc.radius);
  }
  if (aOff.kind === 'arc' && bOff.kind === 'arc') {
    const ca = findPoint(state, aOff.centerId);
    const cb = findPoint(state, bOff.centerId);
    if (!ca || !cb) return [];
    return circleCircleIntersection(ca, aOff.radius, cb, bOff.radius);
  }
  return [];
}

/** True when `q` lies in the angular wedge bounded by (V→a) and
 * (V→b) — i.e., the cross products (Va × Vq) and (Vq × Vb) share a
 * sign with (Va × Vb). Used to detect concave (intersection inside
 * the wedge) vs convex (outside) corners. */
function pointInAngularWedge(V: Pt, a: Pt, b: Pt, q: Pt): boolean {
  const Va = { x: a.x - V.x, y: a.y - V.y };
  const Vb = { x: b.x - V.x, y: b.y - V.y };
  const Vq = { x: q.x - V.x, y: q.y - V.y };
  const cAB = Va.x * Vb.y - Va.y * Vb.x;
  if (Math.abs(cAB) < 1e-9) return false;  // collinear — no wedge
  const cAQ = Va.x * Vq.y - Va.y * Vq.x;
  const cQB = Vq.x * Vb.y - Vq.y * Vb.x;
  // Both sub-cross-products must agree in sign with the full wedge
  // cross product for q to lie strictly between Va and Vb angularly.
  return (cAQ * cAB > 0) && (cQB * cAB > 0);
}

/** Create an arc filler at a convex corner — centered at `V` (a fresh
 * point at V's coords), connecting `aNear.id` to `bNear.id`, going CCW
 * the short way. The two endpoints already lie on a circle of radius =
 * offset distance around V (that's how the offset works), so the
 * filler arc shares those endpoints rather than introducing new ones.
 *
 * Returns the (possibly mutated) state + the new arc's id. */
function addCornerArc(
  state: SketchState, V: Pt,
  aNear: { id: string; pt: Pt }, bNear: { id: string; pt: Pt },
): { state: SketchState; newArcId?: string } {
  // If the two near-V endpoints have coincidentally collapsed onto
  // each other (e.g., a tiny tessellation rounding error), there's
  // nothing to fill.
  const gap = Math.hypot(aNear.pt.x - bNear.pt.x, aNear.pt.y - bNear.pt.y);
  if (gap < 1e-6) return { state };
  const sa = Math.atan2(aNear.pt.y - V.y, aNear.pt.x - V.x);
  const ea = Math.atan2(bNear.pt.y - V.y, bNear.pt.x - V.x);
  let delta = ea - sa;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  const ccw = delta >= 0;
  let s = state;
  const centerR = addPoint(s, V.x, V.y); s = centerR.state;
  const arcR = addArcByPoints(s, centerR.id, aNear.id, bNear.id, ccw);
  s = arcR.state;
  return { state: s, newArcId: arcR.id };
}

/** Mutate a point's coordinates in-place (by id). The point entity's
 * id stays the same — only x/y change. */
function movePointTo(state: SketchState, pointId: string, newPos: Pt): SketchState {
  return {
    ...state,
    entities: state.entities.map(e =>
      e.id === pointId && e.kind === 'point' ? { ...e, x: newPos.x, y: newPos.y } : e,
    ),
  };
}

/** Merge two points: every reference to `removeId` (in entity start/end/
 * center ids and in constraint targets) is rewritten to `keepId`, and
 * the `removeId` point entity is dropped. Used at chain-offset corners
 * so the two-points-coincident pattern collapses to a single shared
 * point — matches SolidWorks's corner topology and removes the
 * redundant DOFs that confused the determinacy analyzer at non-tangent
 * line-arc corners. */
function mergePoints(state: SketchState, keepId: string, removeId: string): SketchState {
  if (keepId === removeId) return state;
  const swap = (id: string) => id === removeId ? keepId : id;
  const entities = state.entities
    .filter(e => e.id !== removeId)
    .map(e => {
      if (e.kind === 'line') return { ...e, startId: swap(e.startId), endId: swap(e.endId) };
      if (e.kind === 'circle') return { ...e, centerId: swap(e.centerId) };
      if (e.kind === 'arc') return { ...e, centerId: swap(e.centerId), startId: swap(e.startId), endId: swap(e.endId) };
      return e;
    });
  const constraints = state.constraints.map(c => ({
    ...c,
    targets: c.targets.map(t => ({ ...t, entityId: swap(t.entityId) })),
  }));
  return { ...state, entities, constraints };
}

/** Find the shared corner vertex between two endpointed entities,
 * matching by coordinate position (not id). Real user-drawn
 * polylines have coincidence-constrained but distinct point ids at
 * each corner; matching by coord lets the offset chain
 * reconciliation pick those up too. Returns the matching endpoint
 * ids on each side plus the shared coord. Null when no endpoint
 * pair matches within tolerance. */
function sharedEndpointBetween(
  state: SketchState, a: SketchEntity, b: SketchEntity,
): { aOrigEndpointId: string; bOrigEndpointId: string; V: Pt } | null {
  if ((a.kind !== 'line' && a.kind !== 'arc') ||
      (b.kind !== 'line' && b.kind !== 'arc')) return null;
  const ae = a as LineEntity | ArcEntity;
  const be = b as LineEntity | ArcEntity;
  const aEps: Array<{ id: string; pt: Pt }> = [];
  const bEps: Array<{ id: string; pt: Pt }> = [];
  for (const id of [ae.startId, ae.endId]) {
    const pt = findPoint(state, id);
    if (pt) aEps.push({ id, pt: { x: pt.x, y: pt.y } });
  }
  for (const id of [be.startId, be.endId]) {
    const pt = findPoint(state, id);
    if (pt) bEps.push({ id, pt: { x: pt.x, y: pt.y } });
  }
  for (const ap of aEps) {
    for (const bp of bEps) {
      if (vertexKeyOf(ap.pt) === vertexKeyOf(bp.pt)) {
        // Use a's coord as the canonical V — its tiny coord-rounding
        // difference from b's coord (well under sketch precision)
        // doesn't affect downstream geometry.
        return { aOrigEndpointId: ap.id, bOrigEndpointId: bp.id, V: ap.pt };
      }
    }
  }
  return null;
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

/** Pure geometry for a fillet between a line and an arc at radius
 * `radius`. The two entities must share a corner (an endpoint). The
 * returned `T_line` is the tangent point on the line; `T_arc` is on
 * the arc curve; `C_F` is the fillet arc center. Returns null when
 * the configuration is invalid (radius too large, entities don't
 * share a corner, etc.).
 *
 * Algorithm:
 *   1. Identify the shared corner V (the line endpoint that matches
 *      the arc endpoint).
 *   2. C_F must satisfy two equations:
 *        - perpendicular distance from C_F to line = radius.
 *        - |C_F − C_A| = R_A ± radius (sign depends on tangency
 *          type: internal vs external).
 *   3. Solve the resulting quadratic in s (parameter along the
 *      offset-line). Up to 8 candidate centers across line-side
 *      and tangency-type combinations. Pick the closest to V.
 *   4. Tangent points: foot of C_F's perpendicular on the line;
 *      C_A + (C_F − C_A)·R_A/|C_F − C_A| on the arc.
 *   5. CCW from cross product of (T_line − C_F) × (T_arc − C_F). */
export interface FilletLineArcGeometry {
  V: Pt;             // shared corner
  T_line: Pt;        // tangent point on line
  T_arc:  Pt;        // tangent point on arc
  C_F:    Pt;        // fillet arc center
  ccw:    boolean;
  radius: number;
  lineId: string;
  arcId:  string;
  line_near_id: string;  // endpoint of the line at V (gets rebound to T_line)
  arc_near_id:  string;  // endpoint of the arc  at V (gets rebound to T_arc)
}
export function computeFilletLineArcGeometry(
  state: SketchState, lineId: string, arcId: string, radius: number,
): FilletLineArcGeometry | null {
  const line = findEntity<LineEntity>(state, lineId);
  const arc = findEntity<ArcEntity>(state, arcId);
  if (!line || line.kind !== 'line' || !arc || arc.kind !== 'arc') return null;
  if (!isFinite(radius) || radius <= EPS) return null;
  const la = findPoint(state, line.startId);
  const lb = findPoint(state, line.endId);
  const aSt = findPoint(state, arc.startId);
  const aEn = findPoint(state, arc.endId);
  const aCe = findPoint(state, arc.centerId);
  if (!la || !lb || !aSt || !aEn || !aCe) return null;
  // Find the shared corner V by coord match on any (line endpoint,
  // arc endpoint) pair. CORNER_TOL is wider than POINT_TOL so user-
  // adjacent corners that have drifted slightly still find each other.
  const CORNER_TOL = 0.01;
  let V: Pt | null = null;
  let line_near_id: string | null = null;
  let arc_near_id: string | null = null;
  for (const [lp, lid] of [[la, line.startId], [lb, line.endId]] as const) {
    for (const [ap, aid] of [[aSt, arc.startId], [aEn, arc.endId]] as const) {
      if (Math.hypot(lp.x - ap.x, lp.y - ap.y) < CORNER_TOL) {
        V = { x: (lp.x + ap.x) / 2, y: (lp.y + ap.y) / 2 };
        line_near_id = lid; arc_near_id = aid;
      }
    }
  }
  if (!V || !line_near_id || !arc_near_id) return null;

  const u_lineDir = { x: lb.x - la.x, y: lb.y - la.y };
  const u_lineLen = Math.hypot(u_lineDir.x, u_lineDir.y);
  if (u_lineLen < EPS) return null;
  const u = { x: u_lineDir.x / u_lineLen, y: u_lineDir.y / u_lineLen };
  // The two unit normals to the line.
  const nA = { x: -u.y, y: u.x };
  const nB = { x:  u.y, y: -u.x };
  // 4 candidate centers — 2 line sides × 2 tangency types (internal /
  // external on the arc). Solve C_F satisfying perpendicular distance
  // r from line AND |C_F - C_A| = R_A ± r.
  const candidates: Pt[] = [];
  for (const n of [nA, nB]) {
    for (const sign of [+1, -1] as const) {  // sign: + external (R+r), - internal (R-r)
      const target = arc.radius + sign * radius;
      if (target <= EPS) continue;  // internal tangent impossible if r > R
      // C_F = la + s*u + r*n. Want |C_F - aCe| = target.
      const Q = { x: la.x + radius * n.x - aCe.x, y: la.y + radius * n.y - aCe.y };
      const b = Q.x * u.x + Q.y * u.y;
      const c = Q.x * Q.x + Q.y * Q.y - target * target;
      const disc = b * b - c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const s of [-b + sq, -b - sq]) {
        candidates.push({ x: la.x + s * u.x + radius * n.x, y: la.y + s * u.y + radius * n.y });
      }
    }
  }
  if (candidates.length === 0) return null;

  // Orientation guidance: pick the candidate sitting in the same
  // direction from V as the corner's bisector (between line's
  // out-of-corner direction and arc's TANGENT at V going toward
  // the far endpoint). Tangent — not chord — because the arc's
  // chord can deviate significantly from the actual direction at V
  // for any non-trivial sweep, which flipped the bisector and
  // caused the fillet to land on the OUTSIDE of the corner. SW
  // always fillets the smaller angle (inside the corner); the
  // tangent-based bisector gives that direction precisely.
  const line_far_id = line.startId === line_near_id ? line.endId : line.startId;
  const lf = findPoint(state, line_far_id);
  if (!lf) return null;
  const ulx = lf.x - V.x, uly = lf.y - V.y;
  const ull = Math.hypot(ulx, uly);
  if (ull < EPS) return null;
  const u_line = { x: ulx / ull, y: uly / ull };
  // Arc tangent at V going toward the FAR endpoint. CCW direction
  // = rotate (V - C_A) by +90°. If V is the arc's start, going
  // toward the end means following arc.ccw. If V is the end,
  // going toward the start means reversing arc.ccw.
  const isArcStart = (arc_near_id === arc.startId);
  const goingForwardCcw = isArcStart ? arc.ccw : !arc.ccw;
  const r_V = { x: V.x - aCe.x, y: V.y - aCe.y };
  const r_Vlen = Math.hypot(r_V.x, r_V.y);
  if (r_Vlen < EPS) return null;
  const tangentCcw = { x: -r_V.y / r_Vlen, y: r_V.x / r_Vlen };
  const u_arc = goingForwardCcw
    ? tangentCcw
    : { x: -tangentCcw.x, y: -tangentCcw.y };
  // Bisector direction (sum of unit vectors). When the entities are
  // tangent at V (u_line ≈ ±u_arc), the bisector collapses → no
  // real corner to fillet.
  const bx = u_line.x + u_arc.x;
  const by = u_line.y + u_arc.y;
  const blen = Math.hypot(bx, by);
  if (blen < EPS) return null;
  const dot = u_line.x * u_arc.x + u_line.y * u_arc.y;
  const clamped = Math.max(-1, Math.min(1, dot));
  const halfAngle = Math.acos(clamped) / 2;
  if (halfAngle < 1e-4 || Math.PI / 2 - halfAngle < 1e-4) return null;
  const D_approx = radius / Math.sin(halfAngle);
  const C_approx = { x: V.x + (bx / blen) * D_approx, y: V.y + (by / blen) * D_approx };

  // Pick the candidate closest to the bisector-guided estimate AND
  // sitting on the bisector's side of V (cross-check via dot with
  // bisector direction so a candidate on the wrong side scores
  // worse). Distance to the approx position is the primary tiebreak.
  let best = candidates[0];
  let bestScore = Infinity;
  for (const cand of candidates) {
    const dvx = cand.x - V.x, dvy = cand.y - V.y;
    const sideDot = dvx * (bx / blen) + dvy * (by / blen);
    if (sideDot <= EPS) continue;  // wrong side or degenerate
    const dd = Math.hypot(cand.x - C_approx.x, cand.y - C_approx.y);
    if (dd < bestScore) { bestScore = dd; best = cand; }
  }
  if (bestScore === Infinity) return null;
  const C_F = best;

  // Tangent points.
  // On the line: perpendicular foot of C_F on the line.
  const dx = C_F.x - la.x, dy = C_F.y - la.y;
  const tProj = dx * u.x + dy * u.y;
  const T_line: Pt = { x: la.x + tProj * u.x, y: la.y + tProj * u.y };
  // On the arc: along the line from arc center to fillet center, at
  // distance R_A from arc center.
  const cax = C_F.x - aCe.x, cay = C_F.y - aCe.y;
  const calen = Math.hypot(cax, cay);
  if (calen < EPS) return null;
  const T_arc: Pt = { x: aCe.x + (cax / calen) * arc.radius, y: aCe.y + (cay / calen) * arc.radius };

  // CCW: positive cross of (T_line - C_F) × (T_arc - C_F).
  const v1x = T_line.x - C_F.x, v1y = T_line.y - C_F.y;
  const v2x = T_arc.x  - C_F.x, v2y = T_arc.y  - C_F.y;
  const ccw = (v1x * v2y - v1y * v2x) > 0;

  return {
    V, T_line, T_arc, C_F, ccw, radius,
    lineId: line.id, arcId: arc.id,
    line_near_id, arc_near_id,
  };
}

/** Apply a line+arc fillet at the shared corner. Rebinds the line's
 * near-V endpoint to T_line and the arc's near-V endpoint to T_arc,
 * inserts a new arc (the fillet) tangent to both, and emits tangent
 * constraints to lock the relationship. */
export function filletLineArc(
  state: SketchState, lineId: string, arcId: string, radius: number,
  options: FilletChamferOptions = {},
): OpResult {
  const line = findEntity<LineEntity>(state, lineId);
  const arc = findEntity<ArcEntity>(state, arcId);
  if (!line || line.kind !== 'line') return { state, error: 'First entity must be a line' };
  if (!arc || arc.kind !== 'arc') return { state, error: 'Second entity must be an arc' };
  if (line.construction || arc.construction) return { state, error: 'Cannot fillet construction geometry' };
  const geom = computeFilletLineArcGeometry(state, lineId, arcId, radius);
  if (!geom) return { state, error: 'Fillet not applicable (radius too large or entities don\'t share a corner)' };

  let s = state;
  const pt_line = addPoint(s, geom.T_line.x, geom.T_line.y); s = pt_line.state;
  const pt_arc = addPoint(s, geom.T_arc.x, geom.T_arc.y); s = pt_arc.state;
  const pc = addPoint(s, geom.C_F.x, geom.C_F.y); s = pc.state;

  // Rebind: line's near-V endpoint → pt_line; arc's near-V endpoint → pt_arc.
  s = {
    ...s,
    entities: s.entities.map(en => {
      if (en.id === line.id && en.kind === 'line') {
        return {
          ...en,
          startId: en.startId === geom.line_near_id ? pt_line.id : en.startId,
          endId:   en.endId   === geom.line_near_id ? pt_line.id : en.endId,
        };
      }
      if (en.id === arc.id && en.kind === 'arc') {
        return {
          ...en,
          startId: en.startId === geom.arc_near_id ? pt_arc.id : en.startId,
          endId:   en.endId   === geom.arc_near_id ? pt_arc.id : en.endId,
        };
      }
      return en;
    }),
  };

  const fillet = addArcByPoints(s, pc.id, pt_line.id, pt_arc.id, geom.ccw);
  s = fillet.state;

  // Tangent: line ↔ fillet AND original arc ↔ fillet.
  s = addConstraint(s, 'tangent', [line.id, fillet.id]).state;
  s = addConstraint(s, 'tangent', [arc.id, fillet.id]).state;
  // Anchor tangent-point slide DOFs so the determinacy analyzer can
  // pin each fillet endpoint linearly.
  s = anchorFilletTangentPoint(s, pc.id, pt_line.id, line);
  s = anchorFilletTangentPoint(s, pc.id, pt_arc.id, arc);

  const constructionLineIds: string[] = [];
  if (options.keepRemovedAsConstruction) {
    const r1 = addTrimConstruction(s, pt_line.id, geom.line_near_id, line.id, geom.V);
    s = r1.state;
    if (r1.lineId) constructionLineIds.push(r1.lineId);
    // For the arc side, we just leave the orphan corner point — no
    // construction equivalent for an arc remnant (arcs aren't lines).
  } else {
    // Drop the old shared corner points if nothing references them
    // anymore. After my merge fix at non-tangent line-arc corners,
    // line_near_id === arc_near_id (single shared point); the second
    // call is a no-op when the first already removed it. Without
    // this, orphan corner points carry 2 free DOFs each and make the
    // determinacy analyzer report the sketch under-constrained.
    s = removeOrphanPoint(s, geom.line_near_id);
    if (geom.arc_near_id !== geom.line_near_id) s = removeOrphanPoint(s, geom.arc_near_id);
  }

  return { state: s, affectedIds: [fillet.id, ...constructionLineIds] };
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
  // Anchor tangent-point slide DOFs so the determinacy analyzer can
  // pin each fillet endpoint linearly.
  s = anchorFilletTangentPoint(s, pc.id, pt1.id, l1);
  s = anchorFilletTangentPoint(s, pc.id, pt2.id, l2);

  const constructionLineIds: string[] = [];
  if (options.keepRemovedAsConstruction) {
    const r1 = addTrimConstruction(s, pt1.id, a_near_id, l1.id, V);
    s = r1.state;
    if (r1.lineId) constructionLineIds.push(r1.lineId);
    const r2 = addTrimConstruction(s, pt2.id, b_near_id, l2.id, V);
    s = r2.state;
    if (r2.lineId) constructionLineIds.push(r2.lineId);
  } else {
    // No construction lines means the original corner point(s) are now
    // orphan — nothing references them. Drop them so the sketch isn't
    // littered with unused points around every fillet. For shared-corner
    // cases (rectangle) a_near_id === b_near_id; both calls hit the same
    // id, and the second one no-ops because the point is already gone.
    s = removeOrphanPoint(s, a_near_id);
    if (b_near_id !== a_near_id) s = removeOrphanPoint(s, b_near_id);
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
  } else {
    // Without construction lines, the original corner point(s) are orphan.
    // Drop them. See filletLines for the full rationale.
    s = removeOrphanPoint(s, a_near_id);
    if (b_near_id !== a_near_id) s = removeOrphanPoint(s, b_near_id);
  }

  const result: OpResult = { state: s, affectedIds: [line1Id, line2Id, cutLine.id] };
  if (constructionLineIds.length > 0) result.constructionLineIds = constructionLineIds;
  return result;
}

/** Drop `pointId` from state if no other entity OR constraint references
 * it. Used by filletLines / chamferLines (without construction lines) to
 * clean up the original corner point after rebinding the incident lines —
 * leaving the point sitting orphan would clutter the sketch with a
 * draggable handle that's not visually attached to anything.
 *
 * Safety: walks every entity's point-referencing fields (start/end/center/
 * majorAxisEnd/controlPointIds) and every constraint's target list. If any
 * reference remains we leave the point alone. */
/** Anchor a fillet endpoint to compensate for the linear-analysis
 * blind spot at tangent points: at a tangent corner all relevant
 * constraint gradients (arc-invariant, line perp-distance, tangent
 * constraint) collapse onto the same axis, leaving the corner's
 * slide DOF unpinned even though it's globally determined.
 *
 * Add a construction line that provides the missing perpendicular
 * gradient:
 *   - Adjacent is a LINE → construction line from fillet center to
 *     the endpoint, constrained perpendicular to the line. For
 *     axis-aligned lines we use vertical/horizontal directly; for
 *     general orientation we use the explicit `perpendicular`
 *     constraint between the construction line and the line.
 *   - Adjacent is an ARC/CIRCLE → construction line from the
 *     adjacent center to the fillet center (the line of centers,
 *     which the tangent point sits on). Plus a `coincident` of the
 *     endpoint with this construction line.
 */
function anchorFilletTangentPoint(
  state: SketchState, filletCenterId: string, endpointId: string,
  adjacent: SketchEntity,
): SketchState {
  let s = state;
  if (adjacent.kind === 'line') {
    const a = findPoint(s, adjacent.startId);
    const b = findPoint(s, adjacent.endId);
    if (!a || !b) return s;
    const dx = b.x - a.x, dy = b.y - a.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    const isHoriz = absDy < absDx * 0.01;
    const isVert = absDx < absDy * 0.01;
    const cline = addLine(s, filletCenterId, endpointId, { construction: true });
    s = cline.state;
    if (isHoriz) s = addConstraint(s, 'vertical', [cline.id]).state;
    else if (isVert) s = addConstraint(s, 'horizontal', [cline.id]).state;
    else s = addConstraint(s, 'perpendicular', [cline.id, adjacent.id]).state;
    return s;
  }
  if (adjacent.kind === 'arc' || adjacent.kind === 'circle') {
    const cline = addLine(s, adjacent.centerId, filletCenterId, { construction: true });
    s = cline.state;
    s = addConstraint(s, 'coincident', [endpointId, cline.id]).state;
    return s;
  }
  return s;
}

function removeOrphanPoint(state: SketchState, pointId: string): SketchState {
  for (const e of state.entities) {
    if (e.id === pointId) continue;
    switch (e.kind) {
      case 'line':
        if (e.startId === pointId || e.endId === pointId) return state;
        break;
      case 'circle':
        if (e.centerId === pointId) return state;
        break;
      case 'arc':
        if (e.centerId === pointId || e.startId === pointId || e.endId === pointId) return state;
        break;
      case 'ellipse':
      case 'ellipticalArc':
        if (e.centerId === pointId || e.majorAxisEndId === pointId) return state;
        break;
      case 'spline':
        if (e.controlPointIds.includes(pointId)) return state;
        break;
      default: break;
    }
  }
  for (const c of state.constraints) {
    if (c.targets.some(t => t.entityId === pointId)) return state;
  }
  return { ...state, entities: state.entities.filter(e => e.id !== pointId) };
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

/**
 * Linear sketch pattern: emit `count - 1` clones of `entityIds`
 * spaced (dx, dy) apart along a single axis. `count = N` produces
 * the original plus N-1 copies (total N occurrences), matching SW's
 * pattern dialog convention.
 */
export function linearPatternEntities(
  state: SketchState, entityIds: string[], dx: number, dy: number, count: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to pattern' };
  if (!isFinite(count) || count < 2) return { state, error: 'Pattern count must be >= 2' };
  if (Math.hypot(dx, dy) < EPS) return { state, error: 'Pattern spacing must be non-zero' };
  let s = state;
  const allCreated: string[] = [];
  for (let i = 1; i < count; i++) {
    const r = copyEntities(s, entityIds, dx * i, dy * i);
    s = r.state;
    if (r.affectedIds) allCreated.push(...r.affectedIds);
  }
  return { state: s, affectedIds: allCreated };
}

/**
 * Circular sketch pattern: emit `count - 1` clones of `entityIds`
 * rotated around `pivot`. `totalAngleRad` is the sweep covered by
 * the WHOLE pattern (original + clones); each clone is rotated by
 * `totalAngleRad / (count - 1) * i` (i = 1..count-1). For a full
 * 360° pattern with N copies, pass totalAngleRad = 2π and count = N.
 */
export function circularPatternEntities(
  state: SketchState, entityIds: string[], pivot: Pt, totalAngleRad: number, count: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to pattern' };
  if (!isFinite(count) || count < 2) return { state, error: 'Pattern count must be >= 2' };
  if (!isFinite(totalAngleRad) || Math.abs(totalAngleRad) < EPS) {
    return { state, error: 'Pattern angle must be non-zero' };
  }
  const step = totalAngleRad / (count - 1);
  let s = state;
  const allCreated: string[] = [];
  for (let i = 1; i < count; i++) {
    // First duplicate at the original position, then rotate that
    // clone into place. copyEntities translates as it copies — we
    // pass (0, 0) so the duplicate lands on top of the original,
    // then rotateEntities pivots it.
    const c = copyEntities(s, entityIds, 0, 0);
    s = c.state;
    if (c.affectedIds && c.affectedIds.length > 0) {
      const r = rotateEntities(s, c.affectedIds, pivot, step * i);
      s = r.state;
      allCreated.push(...c.affectedIds);
    }
  }
  return { state: s, affectedIds: allCreated };
}

/**
 * Jog a line: insert a Z-shaped detour into a straight line. Given
 * two parameters along the line and a perpendicular offset, the
 * single line A→B becomes five segments:
 *
 *     A → P1 → P1' → P2' → P2 → B
 *
 * where P1 and P2 lie on the original line at parameters `t1` and
 * `t2`, and P1' / P2' sit perpendicularly offset from the line by
 * `perpOffset`. The middle segment P1' → P2' runs parallel to the
 * original. Any constraints that referenced the original line are
 * dropped (the topology has changed too radically to rewire safely);
 * the user re-applies them as needed.
 */
export function jogLineAt(
  state: SketchState, lineId: string, t1: number, t2: number, perpOffset: number,
): OpResult {
  const line = findEntity<LineEntity>(state, lineId);
  if (!line || line.kind !== 'line') return { state, error: 'jogLineAt: not a line' };
  if (!isFinite(t1) || !isFinite(t2)) return { state, error: 'Invalid jog parameters' };
  if (t1 < EPS || t2 > 1 - EPS) return { state, error: 'Jog parameters must lie strictly inside [0, 1]' };
  if (t1 >= t2 - EPS) return { state, error: 'Jog end must come after jog start along the line' };
  if (Math.abs(perpOffset) < EPS) return { state, error: 'Jog offset must be non-zero' };
  const a = findPoint(state, line.startId);
  const b = findPoint(state, line.endId);
  if (!a || !b) return { state, error: 'Line endpoints missing' };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return { state, error: 'Line is degenerate' };
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const p1 = { x: a.x + dx * t1,                          y: a.y + dy * t1 };
  const p2 = { x: a.x + dx * t2,                          y: a.y + dy * t2 };
  const p1p = { x: p1.x + nx * perpOffset,                y: p1.y + ny * perpOffset };
  const p2p = { x: p2.x + nx * perpOffset,                y: p2.y + ny * perpOffset };
  let s = deletePrimitive(state, line.id);
  // Endpoint A and B usually survive the delete cascade (other
  // entities or constraints reference them); if not, re-create at
  // their original coords so the new chain still starts/ends where
  // the user expects.
  const aId = s.entities.some(e => e.id === line.startId) ? line.startId
    : (() => { const r = addPoint(s, a.x, a.y); s = r.state; return r.id; })();
  const bId = s.entities.some(e => e.id === line.endId) ? line.endId
    : (() => { const r = addPoint(s, b.x, b.y); s = r.state; return r.id; })();
  const pP1 = addPoint(s, p1.x, p1.y); s = pP1.state;
  const pP1p = addPoint(s, p1p.x, p1p.y); s = pP1p.state;
  const pP2p = addPoint(s, p2p.x, p2p.y); s = pP2p.state;
  const pP2 = addPoint(s, p2.x, p2.y); s = pP2.state;
  const ids: string[] = [];
  const seg = (sId: string, eId: string) => {
    const r = addLine(s, sId, eId); s = r.state; ids.push(r.id);
  };
  seg(aId, pP1.id);
  seg(pP1.id, pP1p.id);
  seg(pP1p.id, pP2p.id);
  seg(pP2p.id, pP2.id);
  seg(pP2.id, bId);
  return { state: s, affectedIds: ids };
}

/**
 * Stretch: like `moveEntities` but only translates the POINT entities
 * in `entityIds`. Lines / curves that share endpoints with the moved
 * points stretch naturally (one endpoint moves, the other stays).
 * SW-style: select a region with a rubber-band, drag — every point
 * inside the box moves, geometry crossing the boundary deforms.
 */
export function stretchEntities(
  state: SketchState, entityIds: string[], dx: number, dy: number,
): OpResult {
  if (entityIds.length === 0) return { state, error: 'No entities to stretch' };
  if (Math.hypot(dx, dy) < EPS) return { state };
  const ids = new Set(entityIds);
  return {
    state: {
      ...state,
      entities: state.entities.map(e => {
        if (e.kind === 'point' && ids.has(e.id) && e.id !== ORIGIN_POINT_ID) {
          return { ...e, x: e.x + dx, y: e.y + dy };
        }
        return e;
      }),
    },
    affectedIds: entityIds,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Rounded rectangles (composite shapes)
// ────────────────────────────────────────────────────────────────────────────
// Built by composing a plain rectangle with four `filletLines` calls — one
// per corner. `filletLines` is the source of truth for fillet geometry
// (correct ccw direction, sided tangent-point placement, tangent +
// anchor-construction-line constraints), so the corners come out convex by
// construction and stay convex when the user dimensions the rectangle.
// Equal-radius constraints chain the four fillet arcs so editing one
// corner's radius drives the others — matches SolidWorks "rounded rectangle"
// behavior.

/** Rounded corner-anchored rectangle. Builds a plain rectangle from
 * `(x1, y1)` to `(x2, y2)` then filletizes each of the four corners
 * with `radius`. Returns the boundary entity ids in CCW order: 4 side
 * lines + 4 corner arcs. */
export function addRoundedRectangleCorners(
  state: SketchState, x1: number, y1: number, x2: number, y2: number, radius: number,
): { state: SketchState; ids: string[] } {
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (w < 1e-6 || h < 1e-6) return { state, ids: [] };
  const r = Math.min(Math.abs(radius), Math.min(w, h) / 2);
  // Degenerate radius — fall through to a plain rect so the user
  // gets something usable instead of an empty commit.
  if (r < 1e-6) return addRectangleCorners(state, x1, y1, x2, y2);
  return _roundCornersOfRect(addRectangleCorners(state, x1, y1, x2, y2), r);
}

/** Rounded center-anchored rectangle. Same fillet approach as the
 * corner-anchored variant, but the underlying rectangle is built by
 * `addRectangleCenter` (which already drops the user's center point +
 * its diagonal construction line). After filleting, a SECOND diagonal
 * is added between two opposite fillet centers — per the user's spec
 * that the center-rounded variant's diagonal runs fillet-center to
 * fillet-center, not corner-to-corner. */
export function addRoundedRectangleCenter(
  state: SketchState,
  cx: number, cy: number, cornerX: number, cornerY: number, radius: number,
  centerPointId?: string,
): { state: SketchState; ids: string[] } {
  const w = 2 * Math.abs(cornerX - cx), h = 2 * Math.abs(cornerY - cy);
  if (w < 1e-6 || h < 1e-6) return { state, ids: [] };
  const r = Math.min(Math.abs(radius), Math.min(w, h) / 2);
  if (r < 1e-6) return addRectangleCenter(state, cx, cy, cornerX, cornerY, centerPointId);
  // Build the base rect (with its corner-corner construction diagonal
  // pinned to centerPointId), then fillet. After filleting, REPLACE
  // the original diagonal — it ran corner-to-corner, but the user
  // asked for fillet-center to fillet-center. We swap by deleting the
  // first diagonal and adding a new one between two opposite arc
  // centers, preserving the midpoint constraint on the same center
  // point.
  const baseRect = addRectangleCenter(state, cx, cy, cornerX, cornerY, centerPointId);
  // baseRect.ids ordering matches addRectangleCenter: [l1, l2, l3, l4,
  // diag, center]. Pull the diagonal + center id out before fillet,
  // then drop the diagonal after filleting so its constraint can be
  // re-pointed at the arc centers.
  const baseDiagId = baseRect.ids[4];
  const baseCenterId = baseRect.ids[5];
  const rounded = _roundCornersOfRect(baseRect, r);
  let s = rounded.state;
  // Identify the 4 arc center ids — we encoded the ordering as
  // [l1, arc1, l2, arc2, l3, arc3, l4, arc4]. Each arc1..arc4 sits at
  // the corner where the preceding line and the following line met:
  //   arc1 = corner between l1 and l2 (BR)
  //   arc2 = corner between l2 and l3 (TR)
  //   arc3 = corner between l3 and l4 (TL)
  //   arc4 = corner between l4 and l1 (BL)
  // For a CCW corner walk starting at BL, that puts BL diagonally
  // opposite TR — so the new diagonal runs from arc4 (BL center) to
  // arc2 (TR center). Reuse the original midpoint-on-center
  // constraint by deleting the old diagonal first.
  const arc1 = findEntity<ArcEntity>(s, rounded.ids[1]);
  const arc2 = findEntity<ArcEntity>(s, rounded.ids[3]);
  const arc3 = findEntity<ArcEntity>(s, rounded.ids[5]);
  const arc4 = findEntity<ArcEntity>(s, rounded.ids[7]);
  if (!arc1 || !arc2 || !arc3 || !arc4) return rounded;
  // Drop the original corner-to-corner diagonal entity + its
  // midpoint constraint targeting it.
  s = {
    ...s,
    entities: s.entities.filter(e => e.id !== baseDiagId),
    constraints: s.constraints.filter(c =>
      !c.targets.some(t => t.entityId === baseDiagId),
    ),
  };
  // New diagonal: BL arc center → TR arc center, construction.
  const newDiag = addLine(s, arc4.centerId, arc2.centerId, { construction: true });
  s = newDiag.state;
  s = addConstraint(s, 'midpoint', [baseCenterId, newDiag.id]).state;
  return { state: s, ids: [...rounded.ids, newDiag.id, baseCenterId] };
}

/** Apply `filletLines` to each of the four corners of a rect-shaped
 * result from `addRectangleCorners` / `addRectangleCenter`. Adds
 * equal-radius constraints chaining the four resulting arcs so one
 * driving dimension governs every corner.
 *
 * Returned ids interleave [side, arc, side, arc, ...] in CCW order
 * starting at l1 (the bottom side from the underlying rectangle
 * builder). Side ids remain stable across filletLines — only the
 * line's endpoint bindings change. Arc ids are pulled from each
 * filletLines OpResult (where they sit at index 2 of `affectedIds`).
 */
function _roundCornersOfRect(
  rect: { state: SketchState; ids: string[] },
  radius: number,
): { state: SketchState; ids: string[] } {
  let s = rect.state;
  const [l1, l2, l3, l4] = rect.ids;  // 4 sides in CCW order (bottom, right, top, left)
  const arcIds: string[] = [];
  const pairs: Array<[string, string]> = [[l1, l2], [l2, l3], [l3, l4], [l4, l1]];
  for (const [a, b] of pairs) {
    const r = filletLines(s, a, b, radius);
    if (r.error || !r.affectedIds || r.affectedIds.length < 3) {
      // A corner failed — most likely radius too large for that
      // side. Bail with the partial state so the user sees the
      // failed config and can adjust, rather than dropping the
      // whole shape.
      return { state: s, ids: rect.ids };
    }
    s = r.state;
    arcIds.push(r.affectedIds[2]);
  }
  // Chain equal-radius constraints across the four fillets so the
  // user can dimension one corner and have the others follow.
  for (let i = 0; i < 3; i++) {
    s = addConstraint(s, 'equal', [arcIds[i], arcIds[i + 1]]).state;
  }
  // Pin the radius MAGNITUDE via an explicit dimension. Without this,
  // the arc radii are only loosely held by tangent + anchor lines —
  // PlaneGCS's arc_rules uses a signed radius internally and the
  // solver can flip the sign when the user dimensions the enclosing
  // rect, producing visibly concave corners (we observed `radius:
  // -28` after a width-dim edit). A literal radius constraint hard-
  // locks the magnitude; the equal chain above propagates the value
  // to the other three arcs, so editing this one dim drives every
  // corner. Default is whatever the caller computed (10% of min(w,h)
  // at the click handler); the user can edit the dim to override.
  s = addConstraint(s, 'radius', [arcIds[0]], radius).state;
  return {
    state: s,
    ids: [l1, arcIds[0], l2, arcIds[1], l3, arcIds[2], l4, arcIds[3]],
  };
}
