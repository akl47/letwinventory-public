import type { SketchState, PointEntity, CircleEntity, ArcEntity, SketchEntity, ConstraintType } from './types';
import { findPoint, pointsOf } from './types';

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
): InferenceResult {
  // (1) Hit-test existing curves (lines / arcs / circles, sketched OR
  // converted). Joining the end of the new line to an existing curve
  // drops a coincident-on-curve constraint so the endpoint slides
  // along it as either side moves.
  const onCurve = nearestCurveHit(state, cursor, LINE_SNAP_TOL);
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
          if (d < LINE_SNAP_TOL && d < pickDist) { pickAdjust = { point: horiz, type: 'horizontal' }; pickDist = d; }
        }
        if (vert) {
          const d = Math.hypot(vert.x - cursor.x, vert.y - cursor.y);
          if (d < LINE_SNAP_TOL && d < pickDist) { pickAdjust = { point: vert, type: 'vertical' }; pickDist = d; }
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
    hint: best.kind === '┃' ? 'aligned' : 'aligned',
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
): { snapped: { x: number; y: number }; hints: string[] } | null {
  const hit = nearestCurveHit(state, cursor, LINE_SNAP_TOL);
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

/** Nearest non-construction line / arc / circle hit within `tol` of
 * `p`. Generalises nearestLineHit so the line tool's second-click
 * snap drops a coincident on ANY curve (including converted on-edge
 * arcs and circles), matching SolidWorks' inference behaviour. */
function nearestCurveHit(
  state: SketchState, p: { x: number; y: number }, tol: number,
): CurveHit | null {
  let best: CurveHit | null = null;
  for (const e of state.entities) {
    if (e.construction || e.kind === 'point') continue;
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
