import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  ConstraintTarget, PointEntity, LineEntity, CircleEntity, ArcEntity,
  EllipseEntity, SplineEntity,
} from './types';
import { findEntity } from './types';

let _seq = 0;
function nextId(prefix: string): string {
  return `${prefix}${++_seq}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function toTargets(input: Array<string | ConstraintTarget>): ConstraintTarget[] {
  return input.map(t => typeof t === 'string' ? { entityId: t } : t);
}

/** Reserved id for the synthetic origin point that every sketch carries.
 * The origin lives at (0, 0) on the sketch plane, is construction (so the
 * solver pins it via `fixed`-style behavior and movePoint refuses to move
 * it), and exists primarily so the user can select it as a reference for
 * constraints — distance from the origin, point-on-line through the origin,
 * etc. Rendered separately by the viewer's origin marker, so the per-entity
 * render loop skips this id. */
export const ORIGIN_POINT_ID = 'origin';

/** PointEntity literal for the origin. Spreading a fresh copy into
 * `entities` keeps the array immutable-friendly. */
export const ORIGIN_POINT: { kind: 'point'; id: string; x: number; y: number; construction: true } = {
  kind: 'point', id: ORIGIN_POINT_ID, x: 0, y: 0, construction: true,
};

export function emptySketchState(): SketchState {
  return { entities: [{ ...ORIGIN_POINT }], constraints: [] };
}

/**
 * Ensure the origin point exists in the given state. Used by the migration
 * path so legacy sketches gain a selectable origin on load without needing
 * an actual schema migration on the server. No-op if the origin is already
 * present.
 */
export function ensureOriginPoint(state: SketchState): SketchState {
  if (state.entities.some(e => e.id === ORIGIN_POINT_ID)) return state;
  return { ...state, entities: [{ ...ORIGIN_POINT }, ...state.entities] };
}

export function addPoint(state: SketchState, x: number, y: number): { state: SketchState; id: string } {
  const id = nextId('p');
  const e: PointEntity = { kind: 'point', id, x, y };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

export function addLine(state: SketchState, startId: string, endId: string): { state: SketchState; id: string } {
  const id = nextId('l');
  const e: LineEntity = { kind: 'line', id, startId, endId };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

export function addCircle(
  state: SketchState, centerX: number, centerY: number, radius: number,
): { state: SketchState; id: string } {
  const id = nextId('cir');
  const centerId = nextId('p');
  const center: PointEntity = { kind: 'point', id: centerId, x: centerX, y: centerY };
  const circ: CircleEntity = { kind: 'circle', id, centerId, radius };
  return { state: { ...state, entities: [...state.entities, center, circ] }, id };
}

/**
 * Build a circle entity that re-uses an existing center-point id. Used by
 * Copy / Rotate-style tools that clone an entity while keeping its support
 * points under control.
 */
export function addCircleByPoint(
  state: SketchState, centerId: string, radius: number,
): { state: SketchState; id: string } {
  const center = findEntity(state, centerId);
  if (!center || center.kind !== 'point') {
    throw new Error('addCircleByPoint: center must exist as a point');
  }
  const id = nextId('cir');
  const c: CircleEntity = { kind: 'circle', id, centerId, radius };
  return { state: { ...state, entities: [...state.entities, c] }, id };
}

/** Build an ellipse entity that re-uses existing point ids. */
export function addEllipseByPoints(
  state: SketchState, centerId: string, majorAxisEndId: string, minorRadius: number,
): { state: SketchState; id: string } {
  const c = findEntity(state, centerId);
  const m = findEntity(state, majorAxisEndId);
  if (!c || c.kind !== 'point' || !m || m.kind !== 'point') {
    throw new Error('addEllipseByPoints: center and majorAxisEnd must exist as points');
  }
  const id = nextId('ell');
  const e: EllipseEntity = { kind: 'ellipse', id, centerId, majorAxisEndId, minorRadius };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Build a spline entity that re-uses existing control-point ids. */
export function addSplineByPoints(
  state: SketchState, controlPointIds: string[], degree: number = 3,
): { state: SketchState; id: string } {
  if (controlPointIds.length < degree + 1) {
    throw new Error('addSplineByPoints: not enough control points');
  }
  for (const cpId of controlPointIds) {
    const e = findEntity(state, cpId);
    if (!e || e.kind !== 'point') {
      throw new Error('addSplineByPoints: control points must exist');
    }
  }
  const id = nextId('spl');
  const s: SplineEntity = { kind: 'spline', id, controlPointIds: [...controlPointIds], degree };
  return { state: { ...state, entities: [...state.entities, s] }, id };
}

/**
 * Build an arc entity that re-uses existing point ids. Use this when you've
 * already placed (or want to reuse) the center / start / end points — for
 * instance the Fillet tool, which creates the tangent points first and then
 * binds them to the new arc.
 */
export function addArcByPoints(
  state: SketchState, centerId: string, startId: string, endId: string, ccw: boolean,
): { state: SketchState; id: string } {
  const center = findEntity(state, centerId);
  const start = findEntity(state, startId);
  if (!center || center.kind !== 'point' || !start || start.kind !== 'point') {
    throw new Error('addArcByPoints: center / start must exist as points');
  }
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const id = nextId('arc');
  const a: ArcEntity = { kind: 'arc', id, centerId, startId, endId, radius, ccw };
  return { state: { ...state, entities: [...state.entities, a] }, id };
}

// Creates an arc from three click locations: center, raw-start, raw-end. The
// radius is taken from |center→start|. The end point is snapped onto the
// circle of that radius so |center→end| == radius (data invariant required by
// renderer/picker/tessellator).
export function addArc(
  state: SketchState,
  centerX: number, centerY: number,
  startX: number, startY: number,
  endX: number, endY: number,
  ccw: boolean,
): { state: SketchState; id: string } {
  const radius = Math.hypot(startX - centerX, startY - centerY);
  // Snap end onto the circle. If the raw end is at the center (zero vector),
  // pick an arbitrary tangent direction so the data invariant still holds.
  const ex = endX - centerX, ey = endY - centerY;
  const elen = Math.hypot(ex, ey);
  const snappedEnd = elen < 1e-9
    ? { x: centerX + radius, y: centerY }
    : { x: centerX + ex * radius / elen, y: centerY + ey * radius / elen };
  const id = nextId('arc');
  const centerId = nextId('p');
  const startId = nextId('p');
  const endId = nextId('p');
  const cp: PointEntity = { kind: 'point', id: centerId, x: centerX, y: centerY };
  const sp: PointEntity = { kind: 'point', id: startId, x: startX, y: startY };
  const ep: PointEntity = { kind: 'point', id: endId, x: snappedEnd.x, y: snappedEnd.y };
  const a: ArcEntity = { kind: 'arc', id, centerId, startId, endId, radius, ccw };
  return { state: { ...state, entities: [...state.entities, cp, sp, ep, a] }, id };
}

// ────────────────────────────────────────────────────────────────────────────
// Composite shape builders. Decompose user-facing primitives (rectangle,
// polygon, slot) into the underlying line/arc/point entities so the rest of
// the system (solver, tessellator, picker, profile extraction) treats them
// like any other hand-drawn sketch.
//
// Returned IDs are the boundary entity IDs in CCW order — useful for the
// editor to pre-populate a selection (e.g., after Rectangle-by-Center, the
// user can immediately add a single Equal constraint on opposite sides).
// ────────────────────────────────────────────────────────────────────────────

/** Axis-aligned rectangle from two opposite corners. */
export function addRectangleCorners(
  state: SketchState, x1: number, y1: number, x2: number, y2: number,
): { state: SketchState; ids: string[] } {
  const xmin = Math.min(x1, x2), xmax = Math.max(x1, x2);
  const ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
  let s = state;
  // 4 corner points + 4 lines, walked CCW from bottom-left.
  const r1 = addPoint(s, xmin, ymin); s = r1.state;
  const r2 = addPoint(s, xmax, ymin); s = r2.state;
  const r3 = addPoint(s, xmax, ymax); s = r3.state;
  const r4 = addPoint(s, xmin, ymax); s = r4.state;
  const l1 = addLine(s, r1.id, r2.id); s = l1.state;
  const l2 = addLine(s, r2.id, r3.id); s = l2.state;
  const l3 = addLine(s, r3.id, r4.id); s = l3.state;
  const l4 = addLine(s, r4.id, r1.id); s = l4.state;
  // Auto-constraints: keep the box rectangular through future edits.
  //   - horizontal(bottom) anchors orientation.
  //   - perpendicular(bottom, right) locks 90° corners.
  //   - parallel pairs lock opposite sides together — necessary, since
  //     perpendicular alone only constrains one corner; the others could
  //     still skew without the parallels.
  // Combined with the 4 shared corner points, these 4 constraints reduce
  // the rectangle's DOF to just width + height (+ position, but that's a
  // separate set of point DOFs the user pins via Fix or dimensions).
  s = addConstraint(s, 'horizontal', [l1.id]).state;
  s = addConstraint(s, 'perpendicular', [l1.id, l2.id]).state;
  s = addConstraint(s, 'parallel', [l1.id, l3.id]).state;
  s = addConstraint(s, 'parallel', [l2.id, l4.id]).state;
  return { state: s, ids: [l1.id, l2.id, l3.id, l4.id] };
}

/**
 * Axis-aligned rectangle around a center point. `corner` is one of the four
 * corners (defines half-width and half-height); the other three mirror it.
 */
export function addRectangleCenter(
  state: SketchState, cx: number, cy: number, cornerX: number, cornerY: number,
): { state: SketchState; ids: string[] } {
  const hw = Math.abs(cornerX - cx);
  const hh = Math.abs(cornerY - cy);
  return addRectangleCorners(state, cx - hw, cy - hh, cx + hw, cy + hh);
}

/**
 * Regular N-sided polygon inscribed in a circle of radius |center→vertex|.
 * Vertex 0 is placed at `(vertexX, vertexY)` and remaining vertices step CCW.
 * `n` must be >= 3.
 */
export function addPolygon(
  state: SketchState, cx: number, cy: number, vertexX: number, vertexY: number, n: number,
): { state: SketchState; ids: string[] } {
  if (n < 3) throw new Error(`polygon sides must be >= 3, got ${n}`);
  const radius = Math.hypot(vertexX - cx, vertexY - cy);
  if (radius < 1e-6) return { state, ids: [] };
  const baseAngle = Math.atan2(vertexY - cy, vertexX - cx);
  let s = state;
  const pointIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = baseAngle + (2 * Math.PI * i) / n;
    const r = addPoint(s, cx + radius * Math.cos(t), cy + radius * Math.sin(t));
    s = r.state;
    pointIds.push(r.id);
  }
  const lineIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = pointIds[i];
    const b = pointIds[(i + 1) % n];
    const l = addLine(s, a, b);
    s = l.state;
    lineIds.push(l.id);
  }
  return { state: s, ids: lineIds };
}

/**
 * Straight slot: two parallel lines connected by two semicircular caps. p1
 * and p2 are the endpoints of the centerline; `halfWidth` is the slot's
 * radius (cap radius == half the slot's perpendicular width).
 */
export function addSlotStraight(
  state: SketchState, p1x: number, p1y: number, p2x: number, p2y: number, halfWidth: number,
): { state: SketchState; ids: string[] } {
  const dx = p2x - p1x, dy = p2y - p1y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || halfWidth < 1e-6) return { state, ids: [] };
  // Perpendicular unit vector (rotate 90° CCW).
  const px = -dy / len, py = dx / len;
  const ox = px * halfWidth, oy = py * halfWidth;
  // Tangent points where the side lines meet each cap.
  const a1x = p1x + ox, a1y = p1y + oy;  // p1 + n
  const a2x = p1x - ox, a2y = p1y - oy;  // p1 - n
  const b1x = p2x + ox, b1y = p2y + oy;  // p2 + n
  const b2x = p2x - ox, b2y = p2y - oy;  // p2 - n

  let s = state;
  const pa1 = addPoint(s, a1x, a1y); s = pa1.state;
  const pa2 = addPoint(s, a2x, a2y); s = pa2.state;
  const pb1 = addPoint(s, b1x, b1y); s = pb1.state;
  const pb2 = addPoint(s, b2x, b2y); s = pb2.state;
  // Side lines: a1 → b1 (top) and b2 → a2 (bottom, reversed for CCW walk).
  const lTop = addLine(s, pa1.id, pb1.id); s = lTop.state;
  const lBot = addLine(s, pb2.id, pa2.id); s = lBot.state;
  // End caps: arc from b1 to b2 around p2 (CCW), and from a2 to a1 around p1 (CCW).
  // The CCW choice ensures the loop walks consistently for profile extraction.
  const arc1 = addArc(s, p2x, p2y, b1x, b1y, b2x, b2y, true); s = arc1.state;
  const arc2 = addArc(s, p1x, p1y, a2x, a2y, a1x, a1y, true); s = arc2.state;
  return { state: s, ids: [lTop.id, arc1.id, lBot.id, arc2.id] };
}

/**
 * Circle through three non-collinear points. Computes the circumscribed
 * center analytically. Returns null state-id pair when points are collinear.
 */
export function addCircle3Points(
  state: SketchState, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
): { state: SketchState; id: string | null } {
  const center = circumcenter(x1, y1, x2, y2, x3, y3);
  if (!center) return { state, id: null };
  const radius = Math.hypot(x1 - center.x, y1 - center.y);
  return addCircle(state, center.x, center.y, radius);
}

/**
 * Arc through three points. Center is the circumcenter of the three; the
 * arc starts at p1, passes through p2, and ends at p3. The `ccw` flag is
 * derived from the sweep direction of the three points around the center.
 */
export function addArc3Points(
  state: SketchState, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
): { state: SketchState; id: string | null } {
  const center = circumcenter(x1, y1, x2, y2, x3, y3);
  if (!center) return { state, id: null };
  // ccw if p2 sits in the CCW half-arc from p1 to p3.
  const a1 = Math.atan2(y1 - center.y, x1 - center.x);
  const a2 = Math.atan2(y2 - center.y, x2 - center.x);
  const a3 = Math.atan2(y3 - center.y, x3 - center.x);
  const norm = (a: number) => { while (a < 0) a += 2 * Math.PI; return a % (2 * Math.PI); };
  const sweepCCW = norm(a3 - a1);
  const midCCW = norm(a2 - a1);
  const ccw = midCCW < sweepCCW;
  return addArc(state, center.x, center.y, x1, y1, x3, y3, ccw);
}

function circumcenter(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): { x: number; y: number } | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;  // collinear
  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;
  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;
  return { x: ux, y: uy };
}

/**
 * Ellipse with axis-aligned major axis going from the center toward
 * `(majorAxisX, majorAxisY)`. `minorRadius` is the half-length of the
 * perpendicular axis.
 */
export function addEllipse(
  state: SketchState, cx: number, cy: number, majorAxisX: number, majorAxisY: number, minorRadius: number,
): { state: SketchState; id: string } {
  const id = nextId('ell');
  const centerId = nextId('p');
  const majorEndId = nextId('p');
  const cp: PointEntity = { kind: 'point', id: centerId, x: cx, y: cy };
  const mp: PointEntity = { kind: 'point', id: majorEndId, x: majorAxisX, y: majorAxisY };
  const ell: EllipseEntity = { kind: 'ellipse', id, centerId, majorAxisEndId: majorEndId, minorRadius };
  return { state: { ...state, entities: [...state.entities, cp, mp, ell] }, id };
}

/**
 * B-spline through control points. Degree defaults to 3 (cubic) — common in
 * CAD sketch tools. Caller passes the control point coordinates and the
 * helper materializes a point entity per control point.
 */
export function addSpline(
  state: SketchState, controlPoints: Array<{ x: number; y: number }>, degree: number = 3,
): { state: SketchState; id: string | null } {
  if (controlPoints.length < degree + 1) return { state, id: null };
  let s = state;
  const controlPointIds: string[] = [];
  for (const p of controlPoints) {
    const r = addPoint(s, p.x, p.y);
    s = r.state;
    controlPointIds.push(r.id);
  }
  const id = nextId('spl');
  const spline: SplineEntity = { kind: 'spline', id, controlPointIds, degree };
  return { state: { ...s, entities: [...s.entities, spline] }, id };
}

export function movePoint(state: SketchState, id: string, x: number, y: number): SketchState {
  // Only the origin is unmovable. Other construction points are visual-only
  // (dashed reference) — the user can drag them just like normal points.
  if (id === ORIGIN_POINT_ID) return state;
  const e = findEntity(state, id);
  if (!e || e.kind !== 'point') return state;
  return {
    ...state,
    entities: state.entities.map(ent =>
      ent.id === id && ent.kind === 'point' ? { ...ent, x, y } : ent,
    ),
  };
}

export function deletePrimitive(state: SketchState, id: string): SketchState {
  // Origin is the one entity that cannot be deleted — every sketch needs it
  // as the coordinate anchor. Construction entities used to be undeletable
  // too (the legacy "locked reference" model), but they're now purely
  // visual (dashed reference, still draggable/dimensionable), so this
  // guard is just for the origin.
  if (id === ORIGIN_POINT_ID) return state;
  const toDelete = new Set<string>([id]);

  // Iterative two-way cascade until stable:
  //   - Forward: any entity that structurally references a doomed point
  //     becomes doomed too (a line referencing a deleted endpoint, a
  //     circle referencing a deleted center, …).
  //   - Backward: a doomed entity's support points get cleaned up too,
  //     UNLESS another surviving entity still references them OR a
  //     surviving constraint still references them. Matches SW: dragging
  //     a line into the bin takes the endpoints with it unless they're
  //     tied to another vertex / constraint.
  let changed = true;
  while (changed) {
    changed = false;

    for (const e of state.entities) {
      if (toDelete.has(e.id)) continue;
      if (supportPointIdsOf(e).some(pid => toDelete.has(pid))) {
        toDelete.add(e.id);
        changed = true;
      }
    }

    for (const e of state.entities) {
      if (!toDelete.has(e.id)) continue;
      for (const ptId of supportPointIdsOf(e)) {
        if (toDelete.has(ptId)) continue;
        if (ptId === ORIGIN_POINT_ID) continue;  // origin always survives
        const stillUsedByEntity = state.entities.some(o =>
          !toDelete.has(o.id) && supportPointIdsOf(o).includes(ptId),
        );
        if (stillUsedByEntity) continue;
        // A constraint "survives" only if every target other than this
        // point also survives. If so, it still pins this point to something.
        const stillUsedByConstraint = state.constraints.some(c =>
          c.targets.some(t => t.entityId === ptId) &&
          c.targets.every(t => t.entityId === ptId || !toDelete.has(t.entityId)),
        );
        if (stillUsedByConstraint) continue;
        toDelete.add(ptId);
        changed = true;
      }
    }
  }

  return {
    entities: state.entities.filter(e => !toDelete.has(e.id)),
    constraints: state.constraints.filter(c => !c.targets.some(t => toDelete.has(t.entityId))),
  };
}

/** Structural point dependencies of an entity. */
function supportPointIdsOf(e: SketchEntity): string[] {
  switch (e.kind) {
    case 'line':          return [e.startId, e.endId];
    case 'circle':        return [e.centerId];
    case 'arc':           return [e.centerId, e.startId, e.endId];
    case 'ellipse':       return [e.centerId, e.majorAxisEndId];
    case 'ellipticalArc': return [e.centerId, e.majorAxisEndId];
    case 'spline':        return [...e.controlPointIds];
    default:              return [];
  }
}

export function addConstraint(
  state: SketchState,
  type: ConstraintType,
  targets: Array<string | ConstraintTarget>,
  value?: number,
  placement?: { x: number; y: number },
): { state: SketchState; constraint: SketchConstraint } {
  const constraint: SketchConstraint = {
    id: nextId('c'),
    type,
    targets: toTargets(targets),
  };
  if (value !== undefined) constraint.value = value;
  if (placement !== undefined) constraint.placement = placement;
  return {
    state: { ...state, constraints: [...state.constraints, constraint] },
    constraint,
  };
}

export function removeConstraint(state: SketchState, constraintId: string): SketchState {
  return { ...state, constraints: state.constraints.filter(c => c.id !== constraintId) };
}

/**
 * Set every entity in `ids` to construction (or non-construction).
 *
 * Construction geometry is reference-only — excluded from profile extraction
 * (REQ 560) but still rendered (dashed) and pinned by the solver for layout
 * purposes (REQ 614 extends this to radii on circles/arcs).
 *
 * Toggles touching a curve also toggle the points the curve depends on
 * (center, endpoints) so the geometry's "reference" status stays coherent.
 */
export function setConstructionFlag(state: SketchState, ids: Iterable<string>, value: boolean): SketchState {
  const targets = new Set<string>(ids);
  // Cascade: when the user toggles a curve, treat its supporting points as
  // part of the same flip. Otherwise the points would render solid while
  // the curve renders dashed, which looks broken.
  for (const e of state.entities) {
    if (!targets.has(e.id)) continue;
    switch (e.kind) {
      case 'line':
        targets.add(e.startId); targets.add(e.endId); break;
      case 'circle':
        targets.add(e.centerId); break;
      case 'arc':
        targets.add(e.centerId); targets.add(e.startId); targets.add(e.endId); break;
      case 'ellipse':
        targets.add(e.centerId); targets.add(e.majorAxisEndId); break;
      case 'spline':
        for (const cp of e.controlPointIds) targets.add(cp);
        break;
    }
  }
  return {
    ...state,
    entities: state.entities.map(e =>
      targets.has(e.id) ? { ...e, construction: value } : e,
    ),
  };
}

/**
 * Update the numeric value of a dimensional constraint. Works for every
 * constraint kind that carries a `value` (distance, radius, diameter, angle,
 * horizontal-distance, vertical-distance, point-line-distance, arc-length).
 * No-op for purely geometric constraints (no value to update).
 */
export function setConstraintValue(state: SketchState, constraintId: string, value: number): SketchState {
  return {
    ...state,
    constraints: state.constraints.map(c => c.id === constraintId ? { ...c, value } : c),
  };
}

export function setDistanceValue(state: SketchState, constraintId: string, value: number): SketchState {
  return {
    ...state,
    constraints: state.constraints.map(c => {
      if (c.id !== constraintId) return c;
      if (c.type !== 'distance') return c;
      return { ...c, value };
    }),
  };
}

