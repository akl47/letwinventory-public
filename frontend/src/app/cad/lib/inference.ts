import type { SketchState, PointEntity, CircleEntity, ArcEntity, SketchEntity, ConstraintType } from './types';
import { findPoint, pointsOf, findEntity } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Constraint inference engine.
//
// Looks at what the user is about to draw and infers geometric constraints
// they probably want: horizontal/vertical lines, points on existing lines,
// coincident endpoints. Each call returns:
//   - the snapped cursor point (locked to the inferred geometry)
//   - the constraint to add after committing the new entity
//   - a `hint` string the renderer can show as a badge ("horizontal", "║", …)
//
// Inference does NOT enforce the constraint by itself — it merely produces
// the (snapPoint, constraint) pair that the tool commit logic will apply.
// That separation keeps the engine pure and easy to test.
//
// Inference does NOT replace coincident point reuse. The sketch editor still
// reuses an existing point's id when the click is within `nearPointThreshold`
// of one; this engine layers on top of that.
// ────────────────────────────────────────────────────────────────────────────

export interface InferenceResult {
  /** Cursor coordinates after snapping to the inferred geometry. */
  snapped: { x: number; y: number };
  /** Primary constraint to add — kept for back-compat with the previous
   * single-constraint API. New callers should read `constraints` instead so
   * the FULL set fires on commit. `null` when no inference applied. */
  constraint: PendingConstraint | null;
  /** Every constraint that fired at this hover/snap. Each item is applied
   * independently after the new entity commits. The first entry equals
   * `constraint` for back-compat. */
  constraints?: PendingConstraint[];
  /** Short label the renderer shows as a snap-hint badge. `null` for no badge.
   * Kept alongside `hints` so older call sites still compile; new code should
   * read `hints` (which is always populated when any badge applies). */
  hint: string | null;
  /** Full list of badges to stack at the snap point — a single hover often
   * fires multiple relations (e.g. 'on line' + 'vertical' for a vertical
   * converted edge). The first entry matches `hint` for back-compat. */
  hints?: string[];
  /** Optional dashed guide lines the renderer can draw to explain WHY the
   * cursor snapped — e.g., a vertical line from a remote sketch point down
   * to the cursor showing the alignment, or a polar ray from the start
   * point through the snapped end. */
  guides?: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
}

export interface PendingConstraint {
  type: ConstraintType;
  /** Index 0 refers to the entity being drawn (the line/circle/arc itself).
   *  Positive indices are pre-existing entity ids.
   *
   *  Example for horizontal: targets = [{ self: true }] → the new line.
   *  Example for point-on-line: targets = [{ pointIndex: 1 }, { entityId: 'l42' }].
   *
   *  The caller resolves `self` to the new entity's id after creation. */
  targets: PendingTarget[];
}

export type PendingTarget =
  | { self: true }
  | { entityId: string }
  | { pointIndex: number };  // index into the new entity's point ids (0 = start, 1 = end, ...)

/** Tolerance for "near-horizontal" / "near-vertical" snapping (radians). */
export const ANGLE_SNAP_TOL = 5 * Math.PI / 180;
/** Distance from a line below which the point snaps onto it. Same scale as
 *  the sketch's 2D unit system (typically mm). */
export const LINE_SNAP_TOL = 2;
/** Polar-tracking angle step (radians). 15° matches SolidWorks's default. */
export const POLAR_STEP = 15 * Math.PI / 180;
/** Tolerance for polar-tracking snap (radians). Tighter than ortho so we
 *  don't over-fire on intermediate angles. */
export const POLAR_TOL = 3 * Math.PI / 180;
/** Tolerance for "cursor is on the vertical / horizontal through another
 *  existing point" alignment (sketch units). */
export const ALIGN_TOL = 1.5;

/**
 * Inference during line drawing. `start` is the first click (already
 * committed); `cursor` is the proposed second click.
 *
 * Order of preference (first match wins):
 *   1. Cursor lies on an existing line → snap to projection + point-on-line
 *   2. Line is near horizontal → snap end's y to start's y + Horizontal
 *   3. Line is near vertical → snap end's x to start's x + Vertical
 *   4. Nothing — return the raw cursor.
 */
export function inferLineEnd(
  state: SketchState,
  start: { x: number; y: number },
  cursor: { x: number; y: number },
  opts?: { curveTol?: number },
): InferenceResult {
  // Review B6: the hover badges and the click commit must measure "am I on
  // this curve?" with the SAME ruler. Callers pass the zoom-adaptive pick
  // tolerance the picker uses; the fixed default only serves legacy callers.
  const curveTol = opts?.curveTol ?? LINE_SNAP_TOL;
  // (1) Hit-test existing curves (lines / arcs / circles, sketched OR
  // converted). Joining the end of the new line to an existing curve
  // drops a coincident-on-curve constraint so the endpoint slides
  // along it as either side moves.
  const onCurve = nearestCurveHit(state, cursor, curveTol);
  if (onCurve) {
    const hints: string[] = [];
    const constraints: PendingConstraint[] = [];
    let snapPoint = onCurve.point;

    // Primary constraint: coincident-on-curve. Unified `coincident`
    // covers point-on-line / point-on-arc / point-on-circle; solver
    // dispatches on target kinds.
    hints.push(onCurve.curve.kind === 'line' ? 'on line'
             : onCurve.curve.kind === 'arc' ? 'on arc'
             : 'on circle');
    constraints.push({
      type: 'coincident',
      targets: [{ pointIndex: 1 }, { entityId: onCurve.curve.id }],
    });

    // Secondary: orthogonality enrichment. When the curve is a LINE,
    // see if the new line from `start` to the curve-hit point lands
    // axis-aligned (horizontal or vertical). If so, snap to the
    // INTERSECTION of the curve's line with the horizontal/vertical
    // line through start so the resulting line is exactly aligned,
    // and emit the matching horizontal/vertical constraint. The
    // intersection candidate has to land within LINE_SNAP_TOL of the
    // cursor so we don't yank the snap far away from where the user
    // pointed. Arcs / circles aren't enriched — adjusting the snap
    // point off the curve would break the on-curve invariant.
    if (onCurve.curve.kind === 'line') {
      const a = findPoint(state, onCurve.curve.startId);
      const b = findPoint(state, onCurve.curve.endId);
      if (a && b) {
        const horiz = intersectLineWithHorizontal(a, b, start.y);
        const vert  = intersectLineWithVertical(a, b, start.x);
        let pickAdjust: { point: { x: number; y: number }; type: 'horizontal' | 'vertical' } | null = null;
        let pickDist = Infinity;
        if (horiz) {
          const d = Math.hypot(horiz.x - cursor.x, horiz.y - cursor.y);
          if (d < curveTol && d < pickDist) { pickAdjust = { point: horiz, type: 'horizontal' }; pickDist = d; }
        }
        if (vert) {
          const d = Math.hypot(vert.x - cursor.x, vert.y - cursor.y);
          if (d < curveTol && d < pickDist) { pickAdjust = { point: vert, type: 'vertical' }; pickDist = d; }
        }
        if (pickAdjust) {
          snapPoint = pickAdjust.point;
          hints.push(pickAdjust.type);
          constraints.push({ type: pickAdjust.type, targets: [{ self: true }] });
        }
      }
    }

    return {
      snapped: snapPoint,
      constraint: constraints[0],
      constraints,
      hint: hints[0],
      hints,
    };
  }
  // (1b) Tangent from a start point that lies ON a circle/arc: when the user
  // draws roughly along the tangent at that point, snap the line onto the
  // tangent ray and add a line↔curve tangent relation (SolidWorks behaviour).
  const tan = tangentFromStart(state, start, cursor);
  if (tan) return tan;
  // (2) and (3): orthogonality snap.
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return raw(cursor);
  const angle = Math.atan2(Math.abs(dy), Math.abs(dx));  // 0 = horizontal, π/2 = vertical
  if (angle < ANGLE_SNAP_TOL) {
    return {
      snapped: { x: cursor.x, y: start.y },
      constraint: { type: 'horizontal', targets: [{ self: true }] },
      hint: 'horizontal',
    };
  }
  if (Math.PI / 2 - angle < ANGLE_SNAP_TOL) {
    return {
      snapped: { x: start.x, y: cursor.y },
      constraint: { type: 'vertical', targets: [{ self: true }] },
      hint: 'vertical',
    };
  }
  // (3b) REQ 864 — perpendicular / parallel against an existing line whose
  // direction the cursor is close to (mod 90°). Fires after H/V (axis
  // alignment wins) and before polar tracking (a real relation beats a
  // visual-only snap). Emits the constraint so the commit locks it in.
  const orient = orientationSnap(state, start, dx, dy);
  if (orient) return orient;
  // (4) Polar tracking — snap to multiples of POLAR_STEP (15°) measured
  // from the absolute +X axis. Visual snap only: no constraint is added
  // because PlaneGCS doesn't have a built-in "fix this angle to N°" type
  // and locking these silently would surprise the user. The hint label
  // tells them which polar angle they're on.
  const polar = polarSnap(start, cursor);
  if (polar) return polar;
  // (5) Alignment with another existing point — vertical or horizontal
  // ray from a remote point through the cursor. Emits a dashed guide so
  // the user can see WHY the cursor snapped to that line.
  const align = alignmentSnap(state, start, cursor);
  if (align) return align;
  return raw(cursor);
}

/** When the line's START point lies on a circle/arc, infer a tangent line: snap
 * the direction to the curve's tangent at that point (perpendicular to the
 * radius) when the cursor is within the angle tolerance, and emit a
 * line↔curve `tangent` relation. Returns null when start isn't on a curve or
 * the cursor isn't near the tangent. */
function tangentFromStart(
  state: SketchState, start: { x: number; y: number }, cursor: { x: number; y: number },
): InferenceResult | null {
  // Find a sketch point coincident at `start` that lies ON a circle/arc.
  let curve: CircleEntity | ArcEntity | null = null;
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    if (Math.hypot(e.x - start.x, e.y - start.y) > 1e-6) continue;
    for (const c of state.constraints) {
      if (c.type !== 'coincident') continue;
      const ids = c.targets.map(t => t.entityId).filter((x): x is string => !!x);
      if (!ids.includes(e.id)) continue;
      for (const id of ids) {
        if (id === e.id) continue;
        const ce = findEntity(state, id);
        if (ce && (ce.kind === 'circle' || ce.kind === 'arc')) { curve = ce; break; }
      }
    }
    if (curve) break;
  }
  if (!curve) return null;
  const center = findPoint(state, curve.centerId);
  if (!center) return null;
  const rx = start.x - center.x, ry = start.y - center.y;
  const rlen = Math.hypot(rx, ry);
  if (rlen < 1e-6) return null;
  // Tangent direction = perpendicular to the radius, signed toward the cursor.
  let tx = -ry / rlen, ty = rx / rlen;
  const cdx = cursor.x - start.x, cdy = cursor.y - start.y;
  const clen = Math.hypot(cdx, cdy);
  if (clen < 1e-6) return null;
  if (tx * cdx + ty * cdy < 0) { tx = -tx; ty = -ty; }
  const cosang = (tx * cdx + ty * cdy) / clen;
  if (cosang < Math.cos(ANGLE_SNAP_TOL)) return null;
  const along = cdx * tx + cdy * ty;  // project the cursor onto the tangent ray
  const constraint: PendingConstraint = { type: 'tangent', targets: [{ self: true }, { entityId: curve.id }] };
  return {
    snapped: { x: start.x + tx * along, y: start.y + ty * along },
    constraint, constraints: [constraint],
    hint: 'tangent', hints: ['tangent'],
  };
}

/** Reserved id for the synthetic sketch origin (mirrors store.ORIGIN_POINT_ID).
 * Duplicated as a literal here to keep this engine free of a store import. */
const ORIGIN_REF_ID = 'origin';

/** One inferred horizontal/vertical relation between the point being placed
 * and a reference point. `horizontal` ⇒ the two points share a Y (a horizontal
 * line joins them); `vertical` ⇒ they share an X. */
export interface AlignmentRef {
  refId: string;
  type: 'horizontal' | 'vertical';
}

export interface AlignmentResult {
  /** Cursor after snapping onto the inferred alignment line(s). */
  snapped: { x: number; y: number };
  /** The relations to create — 0, 1, or 2 entries (at most one H + one V,
   * possibly against different references). Empty when nothing aligned. */
  refs: AlignmentRef[];
  /** Badge labels ('horizontal' / 'vertical') for the snap hint. */
  hints: string[];
  /** Dashed guide lines from each reference point to the snapped cursor. */
  guides: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
}

/**
 * Infer horizontal/vertical alignment of the point being placed against a set
 * of *armed* reference points (OnShape/SolidWorks "pick up a reference"). The
 * origin (id 'origin', always at (0,0)) is implicitly armed; the caller adds
 * any sketch point the cursor has hovered during the gesture.
 *
 * Unlike `inferLineEnd` (which orients the new line relative to its own start),
 * this produces point-to-point relations to external references, so it works
 * for the FIRST click of any tool and for the standalone point tool.
 *
 * Picks the single closest vertical alignment and the single closest horizontal
 * alignment independently, so a point can lock onto one ref's vertical AND a
 * different ref's horizontal at once. If one reference would satisfy both axes
 * (cursor sitting on the point), only the nearer axis is kept — that is
 * coincident territory, not a redundant H+V pair to the same point.
 */
export function inferAlignment(
  state: SketchState,
  cursor: { x: number; y: number },
  armedRefIds: Iterable<string>,
  opts?: { excludeIds?: Iterable<string>; tol?: number },
): AlignmentResult {
  const tol = opts?.tol ?? ALIGN_TOL;
  const exclude = new Set(opts?.excludeIds ?? []);

  // The origin is always a candidate; union it with the caller's armed set.
  const refIds = new Set<string>(armedRefIds);
  refIds.add(ORIGIN_REF_ID);

  const coordsOf = (id: string): { x: number; y: number } | null => {
    if (id === ORIGIN_REF_ID) {
      const p = findPoint(state, ORIGIN_REF_ID);
      return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
    }
    const p = findPoint(state, id);
    return p ? { x: p.x, y: p.y } : null;
  };

  let bestV: { refId: string; ref: { x: number; y: number }; dist: number } | null = null;
  let bestH: { refId: string; ref: { x: number; y: number }; dist: number } | null = null;
  for (const id of refIds) {
    if (exclude.has(id)) continue;
    const ref = coordsOf(id);
    if (!ref) continue;
    const dx = Math.abs(cursor.x - ref.x);
    const dy = Math.abs(cursor.y - ref.y);
    if (dx < tol && (!bestV || dx < bestV.dist)) bestV = { refId: id, ref, dist: dx };
    if (dy < tol && (!bestH || dy < bestH.dist)) bestH = { refId: id, ref, dist: dy };
  }

  // A single ref satisfying both axes means the cursor is on that point —
  // keep only the closer axis (the other is coincident, handled elsewhere).
  if (bestV && bestH && bestV.refId === bestH.refId) {
    if (bestV.dist <= bestH.dist) bestH = null;
    else bestV = null;
  }

  const snapped = { x: cursor.x, y: cursor.y };
  const refs: AlignmentRef[] = [];
  const hints: string[] = [];
  const guides: AlignmentResult['guides'] = [];
  if (bestV) {
    snapped.x = bestV.ref.x;
    refs.push({ refId: bestV.refId, type: 'vertical' });
    hints.push('vertical');
  }
  if (bestH) {
    snapped.y = bestH.ref.y;
    refs.push({ refId: bestH.refId, type: 'horizontal' });
    hints.push('horizontal');
  }
  if (bestV) guides.push({ from: { x: bestV.ref.x, y: bestV.ref.y }, to: { x: snapped.x, y: snapped.y } });
  if (bestH) guides.push({ from: { x: bestH.ref.x, y: bestH.ref.y }, to: { x: snapped.x, y: snapped.y } });

  return { snapped, refs, hints, guides };
}

/** REQ 864 — perpendicular / parallel inference against existing lines.
 * Finds the reference line whose direction (mod 90°) is angularly closest
 * to the drawn direction; within ANGLE_SNAP_TOL the cursor snaps onto the
 * exact ray and the matching constraint fires on commit. The reference
 * line's own segment is emitted as a dashed guide so the user sees WHICH
 * line the relation is against. */
function orientationSnap(
  state: SketchState,
  start: { x: number; y: number },
  dx: number, dy: number,
): InferenceResult | null {
  const drawnAngle = Math.atan2(dy, dx);
  const norm = (a: number) => {
    // Fold into [0, π) — line directions are unsigned.
    let r = a % Math.PI;
    if (r < 0) r += Math.PI;
    return r;
  };
  const drawn = norm(drawnAngle);
  let best: { line: SketchEntity & { kind: 'line' }; type: 'parallel' | 'perpendicular'; target: number; dev: number; a: PointEntity; b: PointEntity } | null = null;
  for (const e of state.entities) {
    if (e.kind !== 'line') continue;
    const a = findPoint(state, e.startId);
    const b = findPoint(state, e.endId);
    if (!a || !b) continue;
    const refLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (refLen < 1e-6) continue;
    const ref = norm(Math.atan2(b.y - a.y, b.x - a.x));
    // Axis-aligned references duplicate the H/V branch — skip them so the
    // badge reads horizontal/vertical, not parallel-to-a-horizontal-line.
    const AX = 1e-3;
    if (ref < AX || Math.PI - ref < AX || Math.abs(ref - Math.PI / 2) < AX) continue;
    for (const [type, target] of [['parallel', ref], ['perpendicular', norm(ref + Math.PI / 2)]] as const) {
      let dev = Math.abs(drawn - target);
      dev = Math.min(dev, Math.PI - dev);
      if (dev < ANGLE_SNAP_TOL && (!best || dev < best.dev)) {
        best = { line: e, type, target, dev, a, b };
      }
    }
  }
  if (!best) return null;
  // Snap onto the exact ray at the target direction, preserving the drawn
  // length and the side of `start` the cursor is on.
  const dirX = Math.cos(best.target), dirY = Math.sin(best.target);
  const t = dx * dirX + dy * dirY;  // signed projection picks the half-ray
  if (Math.abs(t) < 1e-6) return null;
  const snapped = { x: start.x + t * dirX, y: start.y + t * dirY };
  return {
    snapped,
    constraint: { type: best.type, targets: [{ self: true }, { entityId: best.line.id }] },
    constraints: [{ type: best.type, targets: [{ self: true }, { entityId: best.line.id }] }],
    hint: best.type,
    hints: [best.type],
    guides: [{ from: { x: best.a.x, y: best.a.y }, to: { x: best.b.x, y: best.b.y } }],
  };
}

function polarSnap(
  start: { x: number; y: number }, cursor: { x: number; y: number },
): InferenceResult | null {
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const cursorAngle = Math.atan2(dy, dx);
  // Nearest multiple-of-POLAR_STEP angle.
  const k = Math.round(cursorAngle / POLAR_STEP);
  const targetAngle = k * POLAR_STEP;
  // Skip angles already covered by the horizontal/vertical branch.
  const TAU_4 = Math.PI / 2;
  const isOrtho = Math.abs(targetAngle) < 1e-6
    || Math.abs(Math.abs(targetAngle) - TAU_4) < 1e-6
    || Math.abs(Math.abs(targetAngle) - Math.PI) < 1e-6;
  if (isOrtho) return null;
  // Wrap diff into [-π, π].
  let diff = cursorAngle - targetAngle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > POLAR_TOL) return null;
  // Project cursor onto the ray at targetAngle.
  const dirX = Math.cos(targetAngle), dirY = Math.sin(targetAngle);
  const t = dx * dirX + dy * dirY;
  if (t <= 0) return null;  // cursor is "behind" the start along this ray — ignore
  const snapped = { x: start.x + t * dirX, y: start.y + t * dirY };
  const deg = (((targetAngle * 180 / Math.PI) % 360) + 360) % 360;
  return {
    snapped,
    constraint: null,
    hint: `${deg.toFixed(0)}°`,
    guides: [{ from: start, to: snapped }],
  };
}

function alignmentSnap(
  state: SketchState,
  start: { x: number; y: number },
  cursor: { x: number; y: number },
): InferenceResult | null {
  let best: { snapped: { x: number; y: number }; from: { x: number; y: number }; kind: '┃' | '━' } | null = null;
  let bestDist = ALIGN_TOL;
  for (const pt of pointsOf(state)) {
    // Skip the start point of the current line (its own horizontal/vertical
    // is handled by the orthogonality branch above).
    if (Math.abs(pt.x - start.x) < 1e-6 && Math.abs(pt.y - start.y) < 1e-6) continue;
    const dxAlign = Math.abs(cursor.x - pt.x);
    const dyAlign = Math.abs(cursor.y - pt.y);
    // Pick whichever alignment (vertical line through pt OR horizontal) is
    // closer to the cursor, within tolerance.
    if (dxAlign < bestDist) {
      best = { snapped: { x: pt.x, y: cursor.y }, from: { x: pt.x, y: pt.y }, kind: '┃' };
      bestDist = dxAlign;
    }
    if (dyAlign < bestDist) {
      best = { snapped: { x: cursor.x, y: pt.y }, from: { x: pt.x, y: pt.y }, kind: '━' };
      bestDist = dyAlign;
    }
  }
  if (!best) return null;
  return {
    snapped: best.snapped,
    constraint: null,
    // Review B-dead-ternary: surface WHICH axis the cursor aligned with.
    hint: best.kind === '┃' ? 'aligned ┃' : 'aligned ━',
    guides: [{ from: best.from, to: best.snapped }],
  };
}

function raw(cursor: { x: number; y: number }): InferenceResult {
  return { snapped: { x: cursor.x, y: cursor.y }, constraint: null, hint: null };
}

interface CurveHit { curve: SketchEntity; point: { x: number; y: number }; dist: number; }

/** Intersect the line through (a, b) with the horizontal line y=Y.
 * Returns null when the line is itself horizontal (no unique
 * intersection). Used by inferLineEnd to find where a curve crosses
 * the horizontal-through-start so the orthogonality snap fires
 * alongside the on-curve snap. */
function intersectLineWithHorizontal(
  a: { x: number; y: number }, b: { x: number; y: number }, y: number,
): { x: number; y: number } | null {
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-9) return null;
  const t = (y - a.y) / dy;
  return { x: a.x + t * (b.x - a.x), y };
}

/** Intersect the line through (a, b) with the vertical line x=X.
 * Returns null when the line is itself vertical. */
function intersectLineWithVertical(
  a: { x: number; y: number }, b: { x: number; y: number }, x: number,
): { x: number; y: number } | null {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return null;
  const t = (x - a.x) / dx;
  return { x, y: a.y + t * (b.y - a.y) };
}

/** Pre-first-click hover hint for drawing tools. Reports whether the
 * cursor is near a curve (sketched OR converted) so the tool's
 * sketchPreview can render the "on line" / "on arc" / "on circle"
 * inference badges BEFORE the first click is placed. Returns null
 * when no curve is in range — caller renders no hint.
 *
 * `hints` is a list because a single hover often surfaces multiple
 * relations at once: a vertical converted line produces ['on line',
 * 'vertical']; an arc's quadrant produces ['on arc']; etc. Caller
 * stacks each label as its own badge so the user sees ALL the
 * relations that will apply on click.
 *
 * Separate from `inferLineEnd` because that function expects an
 * anchored start point and emits orthogonality / polar fallbacks
 * relative to start; this one is pure-hover-on-curve and looks at
 * the curve's intrinsic geometry only. */
export function inferHoverOnCurve(
  state: SketchState, cursor: { x: number; y: number },
  opts?: { curveTol?: number },
): { snapped: { x: number; y: number }; hints: string[] } | null {
  const hit = nearestCurveHit(state, cursor, opts?.curveTol ?? LINE_SNAP_TOL);
  if (!hit) return null;
  const hints: string[] = [];
  if (hit.curve.kind === 'line') {
    hints.push('on line');
    // Geometry-based orientation: a perfectly axis-aligned line
    // surfaces a 'horizontal' / 'vertical' badge alongside 'on line'.
    // Geometry (not explicit constraints) so a converted edge that's
    // visually vertical reads as vertical even though it has no
    // sketched horizontal/vertical constraint yet — SolidWorks does
    // the same.
    const a = findPoint(state, hit.curve.startId);
    const b = findPoint(state, hit.curve.endId);
    if (a && b) {
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const ORIENT_TOL = 1e-3;
      if (dx < ORIENT_TOL) hints.push('vertical');
      else if (dy < ORIENT_TOL) hints.push('horizontal');
    }
  } else if (hit.curve.kind === 'arc') {
    hints.push('on arc');
  } else if (hit.curve.kind === 'circle') {
    hints.push('on circle');
  }
  return { snapped: hit.point, hints };
}

/** Nearest line / arc / circle hit within `tol` of `p`. Generalises
 * nearestLineHit so the line tool's second-click snap drops a coincident
 * on ANY curve (including converted on-edge arcs and circles), matching
 * SolidWorks' inference behaviour. Construction geometry snaps the same as
 * normal geometry — in SolidWorks construction lines are full inference
 * targets, so they're included here. */
function nearestCurveHit(
  state: SketchState, p: { x: number; y: number }, tol: number,
): CurveHit | null {
  let best: CurveHit | null = null;
  for (const e of state.entities) {
    if (e.kind === 'point') continue;
    let proj: { x: number; y: number } | null = null;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      proj = { x: a.x + dx * t, y: a.y + dy * t };
      // Skip endpoint touches — coincident point reuse handles those.
      const endDist = Math.min(
        Math.hypot(proj.x - a.x, proj.y - a.y),
        Math.hypot(proj.x - b.x, proj.y - b.y),
      );
      if (endDist < 1) continue;
    } else if (e.kind === 'circle') {
      const c = findPoint(state, (e as CircleEntity).centerId);
      if (!c) continue;
      const ddx = p.x - c.x, ddy = p.y - c.y;
      const len = Math.hypot(ddx, ddy);
      if (len < 1e-12) continue;
      proj = { x: c.x + (e as CircleEntity).radius * ddx / len, y: c.y + (e as CircleEntity).radius * ddy / len };
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const c = findPoint(state, ae.centerId);
      const sp = findPoint(state, ae.startId);
      const ep = findPoint(state, ae.endId);
      if (!c || !sp || !ep) continue;
      const ddx = p.x - c.x, ddy = p.y - c.y;
      const len = Math.hypot(ddx, ddy);
      if (len < 1e-12) continue;
      proj = { x: c.x + ae.radius * ddx / len, y: c.y + ae.radius * ddy / len };
      // Skip when the projection lands outside the arc sweep — solver
      // would pull the point onto the sweep at snap time, but that
      // can travel a long way and confuse the user. Require the
      // projection to actually be on the arc.
      const projAngle = Math.atan2(proj.y - c.y, proj.x - c.x);
      const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
      const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
      const norm = (a: number) => { let v = a; while (v < 0) v += 2 * Math.PI; while (v >= 2 * Math.PI) v -= 2 * Math.PI; return v; };
      const sweepFromStart = ae.ccw ? norm(ea - sa) : norm(sa - ea);
      const projFromStart = ae.ccw ? norm(projAngle - sa) : norm(sa - projAngle);
      if (projFromStart > sweepFromStart + 1e-6) continue;
      // Skip endpoint touches.
      const endDist = Math.min(
        Math.hypot(proj.x - sp.x, proj.y - sp.y),
        Math.hypot(proj.x - ep.x, proj.y - ep.y),
      );
      if (endDist < 1) continue;
    }
    if (!proj) continue;
    const d = Math.hypot(proj.x - p.x, proj.y - p.y);
    if (d > tol) continue;
    if (!best || d < best.dist) best = { curve: e, point: proj, dist: d };
  }
  return best;
}
