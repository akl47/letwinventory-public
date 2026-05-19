import type { SketchState, PointEntity, LineEntity, ConstraintType } from './types';
import { findPoint, pointsOf, linesOf } from './types';

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
  /** Constraint to add to the entity being drawn. `null` for "no inference". */
  constraint: PendingConstraint | null;
  /** Short label the renderer shows as a snap-hint badge. `null` for no badge. */
  hint: string | null;
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
  // (1) Hit-test existing lines (skipping any line that uses `start` as an
  // endpoint — joining a line to its predecessor doesn't need a point-on-line
  // constraint, and the predecessor's endpoint should resolve via coincident).
  const onLine = nearestLineHit(state, cursor, LINE_SNAP_TOL);
  if (onLine) {
    return {
      snapped: onLine.point,
      // Target: [endpoint(1) of the new line, the existing line]
      constraint: {
        // Unified `coincident` covers point-on-line; solver dispatches on
        // target kinds.
        type: 'coincident',
        targets: [{ pointIndex: 1 }, { entityId: onLine.line.id }],
      },
      hint: 'on line',
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

interface LineHit {
  line: LineEntity;
  point: { x: number; y: number };
  dist: number;
}

function nearestLineHit(state: SketchState, p: { x: number; y: number }, tol: number): LineHit | null {
  let best: LineHit | null = null;
  for (const l of linesOf(state)) {
    if (l.construction) continue;
    const a = findPoint(state, l.startId);
    const b = findPoint(state, l.endId);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const proj = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(proj.x - p.x, proj.y - p.y);
    // Don't snap to a line at its endpoint — coincident point reuse handles that.
    const endDist = Math.min(Math.hypot(proj.x - a.x, proj.y - a.y), Math.hypot(proj.x - b.x, proj.y - b.y));
    if (d > tol || endDist < 1) continue;
    if (!best || d < best.dist) best = { line: l, point: proj, dist: d };
  }
  return best;
}
