import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  ConstraintTarget, PointEntity, LineEntity, CircleEntity, ArcEntity,
  EllipseEntity, EllipticalArcEntity, SplineEntity, ExternalRef,
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

export function addLine(
  state: SketchState, startId: string, endId: string,
  opts?: { construction?: boolean },
): { state: SketchState; id: string } {
  const id = nextId('l');
  const e: LineEntity = { kind: 'line', id, startId, endId };
  if (opts?.construction) e.construction = true;
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

/** REQ 597 — Add a parabola by three points: vertex, focus, sample.
 * Each is added as a regular point so the user can drag them; the
 * conic references them by id. */
export function addParabolaByPoints(
  state: SketchState, vertexId: string, focusId: string, sampleId: string,
): { state: SketchState; id: string } {
  const id = nextId('con');
  const e: import('./types').ConicEntity = {
    kind: 'conic', id, conicType: 'parabola',
    pointIds: [vertexId, focusId, sampleId],
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — Add an equation curve. The expressions are stored as
 * strings; tessellation evaluates them at render time. */
export function addEquationCurve(
  state: SketchState,
  xExpr: string, yExpr: string,
  tMin: number, tMax: number, samples: number = 100,
): { state: SketchState; id: string } {
  const id = nextId('eq');
  const e: import('./types').EquationCurveEntity = {
    kind: 'equation', id, xExpr, yExpr, tMin, tMax, samples,
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — Add a sketch picture anchored at an existing point. */
export function addPicture(
  state: SketchState, anchorId: string,
  src: string, width: number, height: number,
  rotation: number = 0, opacity: number = 0.6,
): { state: SketchState; id: string } {
  const id = nextId('pic');
  const e: import('./types').PictureEntity = {
    kind: 'picture', id, anchorId, src, width, height, rotation, opacity,
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — legacy text helper. Keep so old call sites still
 * compile; new flow uses `addTextBoxByCorners`. */
export function addText(
  state: SketchState, anchorId: string, text: string, size: number = 5,
): { state: SketchState; id: string } {
  const id = nextId('txt');
  const e: import('./types').TextEntity = {
    kind: 'text', id, anchorId, text, size,
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — drop a text entity whose perimeter is 4 real
 * construction points + 4 construction lines (so the user can
 * dimension the box like any other sketch rectangle). Mirrors the
 * rectangle creation pattern: walk CCW from BL, add
 * horizontal + perpendicular + parallel auto-constraints so the
 * box stays rectangular under future edits. The resulting text
 * scales to fit the rectangle (stretched non-uniformly when the
 * user changes the box aspect). */
export function addTextBoxByCorners(
  state: SketchState, x1: number, y1: number, x2: number, y2: number, text: string,
): { state: SketchState; id: string; cornerIds: [string, string, string, string]; lineIds: [string, string, string, string] } {
  const xmin = Math.min(x1, x2), xmax = Math.max(x1, x2);
  const ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
  let s = state;
  const bl = addPoint(s, xmin, ymin); s = bl.state;
  const br = addPoint(s, xmax, ymin); s = br.state;
  const tr = addPoint(s, xmax, ymax); s = tr.state;
  const tl = addPoint(s, xmin, ymax); s = tl.state;
  const lBot = addLine(s, bl.id, br.id, { construction: true }); s = lBot.state;
  const lRgt = addLine(s, br.id, tr.id, { construction: true }); s = lRgt.state;
  const lTop = addLine(s, tr.id, tl.id, { construction: true }); s = lTop.state;
  const lLft = addLine(s, tl.id, bl.id, { construction: true }); s = lLft.state;
  // Vertical centerline (real construction geometry) down the middle of the
  // box — pinned to the midpoints of the bottom and top edges so it stays
  // centered and rotates with the box.
  const xmid = (xmin + xmax) / 2;
  const bm = addPoint(s, xmid, ymin); s = bm.state;
  const tm = addPoint(s, xmid, ymax); s = tm.state;
  const lCenter = addLine(s, bm.id, tm.id, { construction: true }); s = lCenter.state;
  // The four sides + centerline are CONSTRUCTION: the box is a sizing /
  // positioning reference only. Only the glyph outlines (textGlyphs.ts) become
  // real profile loops, so extruding yields RAISED 3D letters.
  //
  // Constraints: fixed BL anchor + a RIGID, ROTATABLE rectangle
  // (perpendicular corner + parallel opposite sides). The three free DOF are
  // width, height and ANGLE — so the box can be rotated (rotateTextBox moves
  // the real corner points; the lines, dimensions and centerline all follow as
  // ordinary construction geometry). Width/height stay dimensionable.
  s = addConstraint(s, 'fixed', [bl.id]).state;
  s = addConstraint(s, 'perpendicular', [lBot.id, lLft.id]).state;
  s = addConstraint(s, 'parallel', [lBot.id, lTop.id]).state;
  s = addConstraint(s, 'parallel', [lLft.id, lRgt.id]).state;
  s = addConstraint(s, 'midpoint', [bm.id, lBot.id]).state;
  s = addConstraint(s, 'midpoint', [tm.id, lTop.id]).state;
  const id = nextId('txt');
  const e: import('./types').TextEntity = {
    kind: 'text', id, text,
    cornerIds: [bl.id, br.id, tr.id, tl.id],
  };
  return {
    state: { ...s, entities: [...s.entities, e] },
    id,
    cornerIds: [bl.id, br.id, tr.id, tl.id],
    lineIds: [lBot.id, lRgt.id, lTop.id, lLft.id],
  };
}

/** Rotate a text box to an absolute angle (degrees, CCW) by moving its real
 * corner points about the fixed bottom-left anchor — so the construction lines,
 * dimensions and centerline all rotate as normal geometry. The solver then
 * re-pins the centerline midpoints. The angle is derived from the current
 * bottom-edge direction, so it composes correctly across repeated calls. */
export function rotateTextBox(state: SketchState, textId: string, rotationDeg: number): SketchState {
  const te = state.entities.find(e => e.id === textId && e.kind === 'text') as
    import('./types').TextEntity | undefined;
  if (!te || !te.cornerIds || te.cornerIds.length !== 4) return state;
  const [blId, brId, trId, tlId] = te.cornerIds;
  const pt = (id: string) => state.entities.find(e => e.id === id && e.kind === 'point') as
    PointEntity | undefined;
  const bl = pt(blId), br = pt(brId);
  if (!bl || !br) return state;
  const norm = ((rotationDeg % 360) + 360) % 360;
  const cur = Math.atan2(br.y - bl.y, br.x - bl.x);
  const d = norm * Math.PI / 180 - cur;
  const c = Math.cos(d), sn = Math.sin(d);
  const rot = (p: { x: number; y: number }) => ({
    x: bl.x + (p.x - bl.x) * c - (p.y - bl.y) * sn,
    y: bl.y + (p.x - bl.x) * sn + (p.y - bl.y) * c,
  });
  // Rotate the three non-anchor corners; the centerline midpoints follow via
  // their midpoint constraints when the caller re-solves.
  const rotateIds = new Set([brId, trId, tlId]);
  const entities = state.entities.map(en => {
    if (en.kind === 'point' && rotateIds.has(en.id)) {
      const r = rot(en);
      return { ...en, x: r.x, y: r.y };
    }
    if (en.id === textId && en.kind === 'text') return { ...en, rotation: norm };
    return en;
  });
  return { ...state, entities };
}

/** Batch 6 — Add an intersection curve referencing a body. The
 * tessellator computes the intersection of the body's face meshes
 * with the host sketch plane at render time. */
export function addIntersectionCurve(
  state: SketchState, sourceBodyId: string,
): { state: SketchState; id: string } {
  const id = nextId('isc');
  const e: import('./types').IntersectionCurveEntity = {
    kind: 'intersection', id, sourceBodyId,
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — Add a 3D spline whose control points live in a face's
 * uv parameter space. Renderer projects them onto the face. */
export function addSplineOnSurface(
  state: SketchState, faceId: string,
  uvControlPoints: Array<{ u: number; v: number }>, degree: number = 3,
): { state: SketchState; id: string } {
  const id = nextId('sos');
  const e: import('./types').SplineOnSurfaceEntity = {
    kind: 'splineOnSurface', id, faceId,
    uvControlPoints: uvControlPoints.map(p => ({ u: p.u, v: p.v })),
    degree,
  };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

/** Batch 6 — patch a Text entity in place. Caller passes only the
 * fields they want to change (text, justify, etc.). Other entities
 * and the constraint list pass through unchanged. */
export function updateTextEntity(
  state: SketchState, id: string,
  patch: Partial<Pick<import('./types').TextEntity, 'text' | 'size' | 'justify' | 'font' | 'mirror' | 'rotation'>>,
): SketchState {
  return {
    ...state,
    entities: state.entities.map(e =>
      e.id === id && e.kind === 'text' ? { ...e, ...patch } : e),
  };
}

/** Batch 6 — patch a Picture entity in place. */
export function updatePictureEntity(
  state: SketchState, id: string,
  patch: Partial<Pick<import('./types').PictureEntity, 'width' | 'height' | 'rotation' | 'opacity' | 'src'>>,
): SketchState {
  return {
    ...state,
    entities: state.entities.map(e =>
      e.id === id && e.kind === 'picture' ? { ...e, ...patch } : e),
  };
}

/** Batch 6 — patch an Equation curve in place. */
export function updateEquationCurveEntity(
  state: SketchState, id: string,
  patch: Partial<Pick<import('./types').EquationCurveEntity, 'xExpr' | 'yExpr' | 'tMin' | 'tMax' | 'samples'>>,
): SketchState {
  return {
    ...state,
    entities: state.entities.map(e =>
      e.id === id && e.kind === 'equation' ? { ...e, ...patch } : e),
  };
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
 *
 * Also drops a CONSTRUCTION diagonal from BL → TR and pins a stored
 * center point as that diagonal's midpoint. This gives the user a real
 * entity for the rect's center — they can dimension to it, drag it,
 * pattern around it, etc. — and as a side effect the construction
 * line forces the diagonal's slope to match BL↔TR so the rectangle
 * stays centered if dimensions are added.
 */
export function addRectangleCenter(
  state: SketchState, cx: number, cy: number, cornerX: number, cornerY: number,
  /** When provided AND the point exists in `state`, the diagonal's
   * midpoint constraint targets this point instead of creating a fresh
   * one at (cx, cy). Lets the user pin the rectangle to the origin or
   * an existing sketch point with a single click. */
  centerPointId?: string,
): { state: SketchState; ids: string[] } {
  const hw = Math.abs(cornerX - cx);
  const hh = Math.abs(cornerY - cy);
  const xmin = cx - hw, xmax = cx + hw;
  const ymin = cy - hh, ymax = cy + hh;
  let s = state;
  // 4 corners + 4 sides (CCW from BL), mirrors addRectangleCorners.
  const r1 = addPoint(s, xmin, ymin); s = r1.state;
  const r2 = addPoint(s, xmax, ymin); s = r2.state;
  const r3 = addPoint(s, xmax, ymax); s = r3.state;
  const r4 = addPoint(s, xmin, ymax); s = r4.state;
  const l1 = addLine(s, r1.id, r2.id); s = l1.state;
  const l2 = addLine(s, r2.id, r3.id); s = l2.state;
  const l3 = addLine(s, r3.id, r4.id); s = l3.state;
  const l4 = addLine(s, r4.id, r1.id); s = l4.state;
  s = addConstraint(s, 'horizontal', [l1.id]).state;
  s = addConstraint(s, 'perpendicular', [l1.id, l2.id]).state;
  s = addConstraint(s, 'parallel', [l1.id, l3.id]).state;
  s = addConstraint(s, 'parallel', [l2.id, l4.id]).state;
  // Diagonal construction line from BL → TR. Pin its midpoint to the
  // user's anchor point: either the existing point they clicked
  // (origin, an earlier sketch point) or a fresh one at (cx, cy).
  // Reusing an existing point makes the user's intent explicit and
  // lets a single click anchor the rectangle to it.
  const reused = centerPointId ? findEntity(s, centerPointId) : null;
  const centerId = reused && reused.kind === 'point' ? centerPointId! : (() => {
    const p = addPoint(s, cx, cy); s = p.state; return p.id;
  })();
  const diag = addLine(s, r1.id, r3.id, { construction: true }); s = diag.state;
  s = addConstraint(s, 'midpoint', [centerId, diag.id]).state;
  return { state: s, ids: [l1.id, l2.id, l3.id, l4.id, diag.id, centerId] };
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
 * 3-point corner rectangle. The user clicks three points:
 *   - p1: first corner.
 *   - p2: adjacent corner (defines orientation of one edge).
 *   - p3: anywhere on the opposite side of the rectangle from p1↔p2.
 *
 * The other two corners are derived: the rectangle's "height" is the
 * signed perpendicular distance from p3 to the p1→p2 line; the top
 * corners are p1 / p2 shifted by that perpendicular vector.
 *
 * Auto-constraints lock perpendicularity + opposite-side parallelism
 * but NOT orientation (the user already chose the angle by clicking
 * the first edge). That's the difference from `addRectangleCorners`:
 * skipping the `horizontal` constraint lets the rectangle tilt.
 */
export function addRectangle3PtCorner(
  state: SketchState,
  x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
): { state: SketchState; ids: string[] } {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { state, ids: [] };
  // Unit perpendicular (90° CCW from p1→p2 direction).
  const nx = -dy / len, ny = dx / len;
  // Signed perpendicular distance from p3 to the p1→p2 line.
  const offset = (x3 - x1) * nx + (y3 - y1) * ny;
  if (Math.abs(offset) < 1e-6) return { state, ids: [] };
  const x3p = x1 + nx * offset, y3p = y1 + ny * offset;
  const x4p = x2 + nx * offset, y4p = y2 + ny * offset;
  let s = state;
  const r1 = addPoint(s, x1, y1); s = r1.state;
  const r2 = addPoint(s, x2, y2); s = r2.state;
  const r3 = addPoint(s, x4p, y4p); s = r3.state;
  const r4 = addPoint(s, x3p, y3p); s = r4.state;
  const l1 = addLine(s, r1.id, r2.id); s = l1.state;
  const l2 = addLine(s, r2.id, r3.id); s = l2.state;
  const l3 = addLine(s, r3.id, r4.id); s = l3.state;
  const l4 = addLine(s, r4.id, r1.id); s = l4.state;
  s = addConstraint(s, 'perpendicular', [l1.id, l2.id]).state;
  s = addConstraint(s, 'parallel', [l1.id, l3.id]).state;
  s = addConstraint(s, 'parallel', [l2.id, l4.id]).state;
  return { state: s, ids: [l1.id, l2.id, l3.id, l4.id] };
}

/**
 * 3-point center rectangle. The user clicks:
 *   - p1: center.
 *   - p2: midpoint of one side (defines orientation + half-length).
 *   - p3: defines half-width perpendicular to the p1→p2 direction.
 *
 * Computes four corners symmetrically around p1.
 */
export function addRectangle3PtCenter(
  state: SketchState,
  cx: number, cy: number, mx: number, my: number, x3: number, y3: number,
): { state: SketchState; ids: string[] } {
  const dx = mx - cx, dy = my - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { state, ids: [] };
  const ux = dx / len, uy = dy / len;          // along direction
  const nx = -uy, ny = ux;                     // perp direction (90° CCW)
  const halfLen = len;
  const halfWid = (x3 - cx) * nx + (y3 - cy) * ny;
  if (Math.abs(halfWid) < 1e-6) return { state, ids: [] };
  // Four corners: cx ± halfLen·u ± halfWid·n.
  const c1 = { x: cx - ux * halfLen - nx * halfWid, y: cy - uy * halfLen - ny * halfWid };
  const c2 = { x: cx + ux * halfLen - nx * halfWid, y: cy + uy * halfLen - ny * halfWid };
  const c3 = { x: cx + ux * halfLen + nx * halfWid, y: cy + uy * halfLen + ny * halfWid };
  const c4 = { x: cx - ux * halfLen + nx * halfWid, y: cy - uy * halfLen + ny * halfWid };
  let s = state;
  const r1 = addPoint(s, c1.x, c1.y); s = r1.state;
  const r2 = addPoint(s, c2.x, c2.y); s = r2.state;
  const r3 = addPoint(s, c3.x, c3.y); s = r3.state;
  const r4 = addPoint(s, c4.x, c4.y); s = r4.state;
  const l1 = addLine(s, r1.id, r2.id); s = l1.state;
  const l2 = addLine(s, r2.id, r3.id); s = l2.state;
  const l3 = addLine(s, r3.id, r4.id); s = l3.state;
  const l4 = addLine(s, r4.id, r1.id); s = l4.state;
  s = addConstraint(s, 'perpendicular', [l1.id, l2.id]).state;
  s = addConstraint(s, 'parallel', [l1.id, l3.id]).state;
  s = addConstraint(s, 'parallel', [l2.id, l4.id]).state;
  // Diagonal construction line + center point as midpoint, mirroring
  // addRectangleCenter — gives the user a real entity at the center
  // to dimension / drag.
  const center = addPoint(s, cx, cy); s = center.state;
  const diag = addLine(s, r1.id, r3.id, { construction: true }); s = diag.state;
  s = addConstraint(s, 'midpoint', [center.id, diag.id]).state;
  return { state: s, ids: [l1.id, l2.id, l3.id, l4.id, diag.id, center.id] };
}

/**
 * Parallelogram from three corners. The fourth corner is derived from
 * the closure rule (c4 = c1 + (c3 - c2)) so opposite sides are
 * automatically parallel. Auto-constraints lock that parallelism so
 * subsequent edits can't accidentally break the parallelogram shape.
 */
export function addParallelogram(
  state: SketchState, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
): { state: SketchState; ids: string[] } {
  const x4 = x1 + (x3 - x2);
  const y4 = y1 + (y3 - y2);
  let s = state;
  const r1 = addPoint(s, x1, y1); s = r1.state;
  const r2 = addPoint(s, x2, y2); s = r2.state;
  const r3 = addPoint(s, x3, y3); s = r3.state;
  const r4 = addPoint(s, x4, y4); s = r4.state;
  const l1 = addLine(s, r1.id, r2.id); s = l1.state;
  const l2 = addLine(s, r2.id, r3.id); s = l2.state;
  const l3 = addLine(s, r3.id, r4.id); s = l3.state;
  const l4 = addLine(s, r4.id, r1.id); s = l4.state;
  s = addConstraint(s, 'parallel', [l1.id, l3.id]).state;
  s = addConstraint(s, 'parallel', [l2.id, l4.id]).state;
  s = addConstraint(s, 'equal', [l1.id, l3.id]).state;
  s = addConstraint(s, 'equal', [l2.id, l4.id]).state;
  return { state: s, ids: [l1.id, l2.id, l3.id, l4.id] };
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
 * Centerpoint straight slot: input is the slot's CENTER (between caps),
 * one cap center, and the perpendicular distance defining width.
 * Translates to the standard `addSlotStraight` by deriving the two
 * cap centers symmetrically around the input center.
 */
export function addSlotStraightCenterpoint(
  state: SketchState, cx: number, cy: number, capX: number, capY: number, halfWidth: number,
): { state: SketchState; ids: string[] } {
  const dx = capX - cx, dy = capY - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { state, ids: [] };
  // Mirror the cap point across the center → the other cap center.
  const otherX = cx - dx, otherY = cy - dy;
  return addSlotStraight(state, otherX, otherY, capX, capY, halfWidth);
}

/**
 * Arc-slot from three centerline points: build the centerline as an
 * arc through (p1, p2, p3), then sweep `halfWidth` perpendicular on
 * either side. The slot's body is two arcs at the offset radii and
 * two semicircular caps at the centerline endpoints.
 */
export function addSlotArc3Pt(
  state: SketchState,
  p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number,
  halfWidth: number,
): { state: SketchState; ids: string[] } {
  // Re-use addArc3Points's circumcircle math by inlining it here so we
  // can grab the center + radius without committing the centerline to
  // the entity graph (the slot's body uses inner / outer arcs, not the
  // centerline directly).
  const ax = p2x - p1x, ay = p2y - p1y;
  const bx = p3x - p1x, by = p3y - p1y;
  const d = 2 * (ax * by - ay * bx);
  if (Math.abs(d) < 1e-9) return { state, ids: [] };
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const ux = (by * a2 - ay * b2) / d;
  const uy = (ax * b2 - bx * a2) / d;
  const cx = p1x + ux, cy = p1y + uy;
  const r = Math.hypot(ux, uy);
  if (r < 1e-6 || halfWidth < 1e-6 || halfWidth >= r) return { state, ids: [] };
  return _addSlotArc(state, cx, cy, p1x, p1y, p3x, p3y, r, halfWidth);
}

/**
 * Centerpoint arc-slot: input is the arc's CENTER, start, end +
 * `halfWidth`. The centerline is the arc with that center / endpoints.
 */
export function addSlotArcCenterpoint(
  state: SketchState,
  cx: number, cy: number, sx: number, sy: number, ex: number, ey: number,
  halfWidth: number,
): { state: SketchState; ids: string[] } {
  const r = Math.hypot(sx - cx, sy - cy);
  if (r < 1e-6 || halfWidth < 1e-6 || halfWidth >= r) return { state, ids: [] };
  // Snap the end onto the radius circle (mirrors addArc's invariant)
  // so the inner/outer arcs are concentric and well-formed.
  const eAng = Math.atan2(ey - cy, ex - cx);
  const exSnap = cx + r * Math.cos(eAng), eySnap = cy + r * Math.sin(eAng);
  return _addSlotArc(state, cx, cy, sx, sy, exSnap, eySnap, r, halfWidth);
}

/** Shared arc-slot body builder. Given the centerline arc's center,
 * start, end, radius, and the slot's half-width, emits:
 *   - inner arc (radius - halfWidth) from inner-start to inner-end
 *   - outer arc (radius + halfWidth) from outer-end to outer-start
 *   - two semicircular caps at the centerline endpoints
 * All four entities + their shared corner points form a closed CCW
 * loop ready for profile extraction. */
function _addSlotArc(
  state: SketchState,
  cx: number, cy: number, sx: number, sy: number, ex: number, ey: number,
  r: number, halfWidth: number,
): { state: SketchState; ids: string[] } {
  const sAng = Math.atan2(sy - cy, sx - cx);
  const eAng = Math.atan2(ey - cy, ex - cx);
  const rIn = r - halfWidth;
  const rOut = r + halfWidth;
  const cosS = Math.cos(sAng), sinS = Math.sin(sAng);
  const cosE = Math.cos(eAng), sinE = Math.sin(eAng);
  const innerStart = { x: cx + rIn * cosS,  y: cy + rIn * sinS };
  const innerEnd   = { x: cx + rIn * cosE,  y: cy + rIn * sinE };
  const outerStart = { x: cx + rOut * cosS, y: cy + rOut * sinS };
  const outerEnd   = { x: cx + rOut * cosE, y: cy + rOut * sinE };
  let s = state;
  const pIs = addPoint(s, innerStart.x, innerStart.y); s = pIs.state;
  const pIe = addPoint(s, innerEnd.x,   innerEnd.y);   s = pIe.state;
  const pOs = addPoint(s, outerStart.x, outerStart.y); s = pOs.state;
  const pOe = addPoint(s, outerEnd.x,   outerEnd.y);   s = pOe.state;
  // Inner arc (smaller radius) CCW from innerStart → innerEnd.
  const inner = addArc(s, cx, cy, innerStart.x, innerStart.y, innerEnd.x, innerEnd.y, true); s = inner.state;
  // Outer arc CCW from outerEnd → outerStart (reverse direction for CCW loop).
  const outer = addArc(s, cx, cy, outerEnd.x, outerEnd.y, outerStart.x, outerStart.y, true); s = outer.state;
  // Cap at end: arc from innerEnd to outerEnd around (ex, ey).
  const capEnd = addArc(s, ex, ey, innerEnd.x, innerEnd.y, outerEnd.x, outerEnd.y, true); s = capEnd.state;
  // Cap at start: arc from outerStart to innerStart around (sx, sy).
  const capStart = addArc(s, sx, sy, outerStart.x, outerStart.y, innerStart.x, innerStart.y, true); s = capStart.state;
  return { state: s, ids: [inner.id, capEnd.id, outer.id, capStart.id] };
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
 * Partial ellipse (elliptical arc). Materializes a center point and a
 * major-axis-endpoint point, then builds an EllipticalArcEntity that
 * sweeps from `startAngle` to `endAngle` (radians, measured in the
 * ellipse's local frame where +x runs along center→majorAxisEnd).
 * `ccw` controls sweep direction.
 *
 * Tessellator + picker pick up elliptical arcs the same way they do
 * ellipses — the kind discriminant routes them. Solver primitives for
 * elliptical-arc-specific constraints aren't wired yet; the entity is
 * positionally free unless its supporting points / major-axis radius
 * are pinned by other means.
 */
export function addEllipticalArc(
  state: SketchState,
  cx: number, cy: number, majorAxisX: number, majorAxisY: number,
  minorRadius: number, startAngle: number, endAngle: number, ccw: boolean = true,
): { state: SketchState; id: string } {
  const id = nextId('earc');
  const centerId = nextId('p');
  const majorEndId = nextId('p');
  const cp: PointEntity = { kind: 'point', id: centerId, x: cx, y: cy };
  const mp: PointEntity = { kind: 'point', id: majorEndId, x: majorAxisX, y: majorAxisY };
  const ea: EllipticalArcEntity = {
    kind: 'ellipticalArc', id, centerId, majorAxisEndId: majorEndId,
    minorRadius, startAngle, endAngle, ccw,
  };
  return { state: { ...state, entities: [...state.entities, cp, mp, ea] }, id };
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
  driven?: boolean,
  externalRef?: ExternalRef,
): { state: SketchState; constraint: SketchConstraint } {
  const constraint: SketchConstraint = {
    id: nextId('c'),
    type,
    targets: toTargets(targets),
  };
  if (value !== undefined) constraint.value = value;
  if (placement !== undefined) constraint.placement = placement;
  if (driven) constraint.driven = true;
  if (externalRef) constraint.externalRef = externalRef;
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

/** Collapse two point entities into one. Every entity reference to
 * `dropId` (line endpoints, circle/arc/ellipse centers, arc/ellipse
 * start/end, spline control points) is rewritten to `keepId`; every
 * constraint targeting `dropId` is either rewired to `keepId` or, if
 * doing so would make the constraint self-referential (both targets
 * point to the same entity), dropped. The `dropId` point entity is
 * then removed.
 *
 * Mirrors SolidWorks's Merge Points relation: collapses two
 * coincident-by-position points into a single identity so subsequent
 * edits move both endpoints together by construction, not via a
 * solver-maintained equality. The keep/drop choice is the caller's —
 * typically the older / more-referenced point is kept.
 *
 * No-op when either id is missing, when both ids are the same, or
 * when `dropId` is the origin (which can't be deleted). */
export function mergePoints(state: SketchState, keepId: string, dropId: string): SketchState {
  if (keepId === dropId) return state;
  if (dropId === ORIGIN_POINT_ID) return state;
  const keep = state.entities.find(e => e.id === keepId);
  const drop = state.entities.find(e => e.id === dropId);
  if (!keep || keep.kind !== 'point' || !drop || drop.kind !== 'point') return state;
  const remap = (id: string) => id === dropId ? keepId : id;
  const entities = state.entities
    .filter(e => e.id !== dropId)
    .map(e => {
      switch (e.kind) {
        case 'line':    return { ...e, startId: remap(e.startId), endId: remap(e.endId) };
        case 'circle':  return { ...e, centerId: remap(e.centerId) };
        case 'arc':     return { ...e, centerId: remap(e.centerId), startId: remap(e.startId), endId: remap(e.endId) };
        case 'ellipse': return { ...e, centerId: remap(e.centerId), majorAxisEndId: remap(e.majorAxisEndId) };
        case 'ellipticalArc': return { ...e, centerId: remap(e.centerId), majorAxisEndId: remap(e.majorAxisEndId) };
        case 'spline':  return { ...e, controlPointIds: e.controlPointIds.map(remap) };
        default:        return e;
      }
    });
  const constraints = state.constraints
    .map(c => ({ ...c, targets: c.targets.map(t => t.entityId === dropId ? { ...t, entityId: keepId } : t) }))
    // Drop self-referential constraints (e.g. coincident(P,P) after
    // both targets collapsed onto the same id) — they're vacuous and
    // would just clutter the system.
    .filter(c => {
      if (c.targets.length < 2) return true;
      const ids = c.targets.map(t => t.entityId);
      return new Set(ids).size === ids.length;
    });
  return { entities, constraints };
}

