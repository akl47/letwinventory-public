import type {
  SketchState, SketchConstraint, PointEntity, LineEntity, CircleEntity, ArcEntity,
  ConstraintType, SketchEntity,
} from './types';
import { findPoint, findEntity } from './types';
import { formatWithUnit, unitSymbol, type Unit } from './units';

// Re-export so existing callers that import formatNumber from this module
// don't have to chase down the new path.
export { formatNumber } from './units';

/** SolidWorks-style 2-point dim type chooser. The dimension type follows
 * the label's position:
 *   - cursor inside the bbox's x-range but outside the y-range → the
 *     label sits above/below, so `horizontal-distance` (Δx).
 *   - cursor inside the bbox's y-range but outside the x-range → the
 *     label sits left/right, so `vertical-distance` (Δy).
 *   - cursor inside or in a diagonal corner outside → minimum
 *     (Euclidean) distance.
 *
 * Returns 'distance' when no cursor is supplied. */
export function chooseTwoPointDimType(
  p1: PointEntity, p2: PointEntity, cursor: { x: number; y: number } | null,
): 'distance' | 'horizontal-distance' | 'vertical-distance' {
  if (!cursor) return 'distance';
  const xmin = Math.min(p1.x, p2.x), xmax = Math.max(p1.x, p2.x);
  const ymin = Math.min(p1.y, p2.y), ymax = Math.max(p1.y, p2.y);
  const tol = 1e-6;
  const inX = cursor.x >= xmin - tol && cursor.x <= xmax + tol;
  const inY = cursor.y >= ymin - tol && cursor.y <= ymax + tol;
  if (inX && !inY) return 'horizontal-distance';
  if (inY && !inX) return 'vertical-distance';
  return 'distance';
}

/** Pure helper: the dimension VALUE for a 2-point dim of the given type
 * at the given points' current positions. Keeps the type-value pair
 * consistent for both initial placement and post-commit label drag.
 *
 * Returns an unsigned magnitude — h/v-distance constraints store the
 * magnitude and the solver picks the sign from current geometry at
 * translate time. */
export function twoPointDimValue(
  p1: PointEntity, p2: PointEntity, type: 'distance' | 'horizontal-distance' | 'vertical-distance',
): number {
  if (type === 'horizontal-distance') return Math.abs(p2.x - p1.x);
  if (type === 'vertical-distance')   return Math.abs(p2.y - p1.y);
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// ────────────────────────────────────────────────────────────────────────────
// Dimension annotation derivation (SolidWorks-style).
//
// For each dimensional constraint, emit a `DimensionRender` carrying:
//   - text: formatted value with unit prefix/suffix per kind
//   - labelAnchor: 2D anchor for the value pill (on the dimension line)
//   - dimensionLine: the two endpoints of the line the value is placed on,
//     or null for kinds that don't have one (e.g. radius leader)
//   - extensionLines: from each measured point to the dimension line, so
//     the user sees which features the dimension is measuring
//
// Placement: each constraint may carry an explicit `placement` (set by the
// Smart Dim flow when the user clicks where the dimension line goes).
// Without one, we fall back to a sensible default offset from the
// geometry's midpoint so legacy dimensions still render.
//
// Pure geometry — no DOM, no Three.js. cad-viewer projects each 2D point
// onto the sketch plane and renders the lines via Three.js, plus a CSS2D
// label at labelAnchor.
// ────────────────────────────────────────────────────────────────────────────

export interface DimensionRender {
  constraintId: string;
  text: string;
  labelAnchor: { x: number; y: number };
  dimensionLine: [{ x: number; y: number }, { x: number; y: number }] | null;
  extensionLines: Array<[{ x: number; y: number }, { x: number; y: number }]>;
}

const DIMENSIONAL_TYPES = new Set<ConstraintType>([
  'distance', 'radius', 'diameter', 'angle',
  'horizontal-distance', 'vertical-distance', 'point-line-distance', 'arc-length',
]);

/** Default offset (in sketch units) used when a constraint has no
 * explicit placement — keeps the dimension visibly clear of the geometry. */
const DEFAULT_OFFSET = 8;

/**
 * Format a constraint value with its kind-specific unit prefix/suffix.
 *
 * Length-type constraints honor the per-constraint unit override if set,
 * else the model's defaultUnit. The unit suffix is ALWAYS shown — every
 * length dim reads as "10 mm" / "0.5 in" / "200 µm" so there's never any
 * ambiguity about what unit a value is in.
 *
 * Angle is always degrees with the ° symbol — units don't apply.
 */
export function formatDimensionText(
  type: ConstraintType, value: number,
  dimUnit: Unit | undefined,
  defaultUnit: Unit,
): string {
  if (type === 'angle') return formatWithUnit(value * 180 / Math.PI, 'mm', false).replace(/$/, '°');
  const unit = dimUnit ?? defaultUnit;
  const num = formatWithUnit(value, unit, true);
  switch (type) {
    case 'radius': return 'R ' + num;
    case 'diameter': return '⌀ ' + num;
    case 'horizontal-distance': return '↔ ' + num;
    case 'vertical-distance': return '↕ ' + num;
    case 'point-line-distance': return '⊥ ' + num;
    case 'arc-length': return '~ ' + num;
    default: return num;
  }
}

void unitSymbol;  // kept for re-export consumers

export function dimensionRenders(state: SketchState, defaultUnit: Unit = 'mm'): DimensionRender[] {
  const out: DimensionRender[] = [];
  for (const c of state.constraints) {
    if (!DIMENSIONAL_TYPES.has(c.type) || c.value === undefined) continue;
    const r = renderConstraint(state, c, defaultUnit);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Compute a `DimensionRender` for a constraint that may not yet exist
 * (i.e. a Smart Dim PREVIEW between pick 2 and the placement click).
 * Caller supplies the targets, value, and placement directly.
 */
export function previewDimension(
  state: SketchState,
  type: ConstraintType,
  targetIds: string[],
  value: number,
  placement: { x: number; y: number },
  defaultUnit: Unit = 'mm',
): DimensionRender | null {
  return computeRender(state, '__preview__', type, targetIds, value, placement, undefined, defaultUnit);
}

function renderConstraint(state: SketchState, c: SketchConstraint, defaultUnit: Unit): DimensionRender | null {
  return computeRender(
    state, c.id, c.type, c.targets.map(t => t.entityId), c.value!, c.placement, c.unit, defaultUnit,
  );
}

function computeRender(
  state: SketchState,
  constraintId: string,
  type: ConstraintType,
  targetIds: string[],
  value: number,
  placement: { x: number; y: number } | undefined,
  dimUnit: Unit | undefined,
  defaultUnit: Unit,
): DimensionRender | null {
  const text = formatDimensionText(type, value, dimUnit, defaultUnit);
  switch (type) {
    case 'distance':
    case 'horizontal-distance':
    case 'vertical-distance': {
      const a = findPoint(state, targetIds[0]);
      const b = findPoint(state, targetIds[1]);
      if (!a || !b) return null;
      return distanceRender(constraintId, text, a, b, placement, type);
    }
    case 'radius': {
      const e = findEntity(state, targetIds[0]);
      if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return null;
      return radiusRender(constraintId, text, state, e as CircleEntity | ArcEntity, placement);
    }
    case 'diameter': {
      const e = findEntity(state, targetIds[0]);
      if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return null;
      return diameterRender(constraintId, text, state, e as CircleEntity | ArcEntity, placement);
    }
    case 'angle': {
      const a = findEntity(state, targetIds[0]);
      const b = findEntity(state, targetIds[1]);
      if (!a || a.kind !== 'line' || !b || b.kind !== 'line') return null;
      return angleRender(constraintId, text, state, a as LineEntity, b as LineEntity, placement);
    }
    case 'point-line-distance': {
      const p = findPoint(state, targetIds[0]);
      const l = findEntity(state, targetIds[1]);
      if (!p || !l || l.kind !== 'line') return null;
      return pointLineDistanceRender(constraintId, text, state, p, l as LineEntity, placement);
    }
    case 'arc-length': {
      const e = findEntity(state, targetIds[0]);
      if (!e || e.kind !== 'arc') return null;
      // Simple leader-style render (no extension lines).
      const a = e as ArcEntity;
      const c = findPoint(state, a.centerId);
      if (!c) return null;
      const start = findPoint(state, a.startId);
      const end = findPoint(state, a.endId);
      if (!start || !end) return null;
      const sa = Math.atan2(start.y - c.y, start.x - c.x);
      const ea = Math.atan2(end.y - c.y, end.x - c.x);
      let mid = (sa + ea) / 2;
      if (a.ccw && ea < sa) mid += Math.PI;
      if (!a.ccw && ea > sa) mid += Math.PI;
      const labelAnchor = placement ?? {
        x: c.x + (a.radius + DEFAULT_OFFSET) * Math.cos(mid),
        y: c.y + (a.radius + DEFAULT_OFFSET) * Math.sin(mid),
      };
      return { constraintId, text, labelAnchor, dimensionLine: null, extensionLines: [] };
    }
  }
  return null;
}

// ── per-kind layout helpers ──────────────────────────────────────────────

/**
 * Distance between two points. The dimension line is parallel to the
 * segment AB at a perpendicular offset; extension lines run from A and B
 * to the dimension line. Horizontal/vertical variants force the dim line
 * to the X or Y axis respectively.
 */
function distanceRender(
  constraintId: string, text: string,
  a: PointEntity, b: PointEntity,
  placement: { x: number; y: number } | undefined,
  type: ConstraintType,
): DimensionRender {
  let ux = b.x - a.x, uy = b.y - a.y;
  // For horizontal-distance, the dim line is horizontal: extension lines
  // are vertical (from A's and B's Y values up/down to the dim line at
  // placement.y). Compose by treating the "direction" as +X.
  if (type === 'horizontal-distance') { ux = 1; uy = 0; }
  if (type === 'vertical-distance')   { ux = 0; uy = 1; }
  const len = Math.hypot(ux, uy);
  if (len < 1e-9) {
    return { constraintId, text, labelAnchor: { x: a.x, y: a.y }, dimensionLine: null, extensionLines: [] };
  }
  ux /= len; uy /= len;
  const nx = -uy, ny = ux;  // unit perpendicular (rotate 90° CCW)
  // Signed perpendicular distance from a to the placement. If no placement
  // supplied, use a default offset.
  const offset = placement
    ? (placement.x - a.x) * nx + (placement.y - a.y) * ny
    : DEFAULT_OFFSET;
  // Endpoints of the dimension line — A and B projected onto the dim
  // line's axis (which is parallel to the segment for plain Distance, or
  // axis-aligned for horizontal/vertical variants).
  let aProj: { x: number; y: number };
  let bProj: { x: number; y: number };
  if (type === 'horizontal-distance' || type === 'vertical-distance') {
    // Witness lines run perpendicular to the dim line; the dim line is
    // axis-aligned, passing through `placement` (whichever axis is fixed
    // by the dim type). The generic perpendicular-offset formula above
    // gives the wrong sign for vertical-distance (perp = -x), so we
    // bypass it here and use placement coords directly.
    if (type === 'horizontal-distance') {
      const y = placement ? placement.y : a.y + DEFAULT_OFFSET;
      aProj = { x: a.x, y };
      bProj = { x: b.x, y };
    } else {
      const x = placement ? placement.x : a.x + DEFAULT_OFFSET;
      aProj = { x, y: a.y };
      bProj = { x, y: b.y };
    }
  } else {
    aProj = { x: a.x + nx * offset, y: a.y + ny * offset };
    bProj = { x: b.x + nx * offset, y: b.y + ny * offset };
  }
  const labelAnchor = { x: (aProj.x + bProj.x) / 2, y: (aProj.y + bProj.y) / 2 };
  return {
    constraintId, text, labelAnchor,
    dimensionLine: [aProj, bProj],
    extensionLines: [[a, aProj], [b, bProj]],
  };
}

/**
 * Radius dimension. Leader from the curve's edge (at the angle pointing
 * toward the placement) out to the label anchor (slightly past the edge).
 * No witness lines — radius is conventionally drawn as a single leader.
 */
function radiusRender(
  constraintId: string, text: string,
  state: SketchState, e: CircleEntity | ArcEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const c = findPoint(state, e.centerId);
  if (!c) return null;
  const target = placement ?? { x: c.x + e.radius + DEFAULT_OFFSET, y: c.y };
  const dx = target.x - c.x, dy = target.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { constraintId, text, labelAnchor: { x: c.x + e.radius, y: c.y }, dimensionLine: null, extensionLines: [] };
  }
  const edge = { x: c.x + (dx / len) * e.radius, y: c.y + (dy / len) * e.radius };
  return {
    constraintId, text,
    labelAnchor: target,
    dimensionLine: [edge, target],
    extensionLines: [],
  };
}

/**
 * Diameter dimension. Line through the center to both edges of the curve,
 * along the direction from center to placement. Label sits at placement.
 */
function diameterRender(
  constraintId: string, text: string,
  state: SketchState, e: CircleEntity | ArcEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const c = findPoint(state, e.centerId);
  if (!c) return null;
  const target = placement ?? { x: c.x + e.radius + DEFAULT_OFFSET, y: c.y };
  const dx = target.x - c.x, dy = target.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { constraintId, text, labelAnchor: { x: c.x, y: c.y }, dimensionLine: null, extensionLines: [] };
  }
  const e1 = { x: c.x + (dx / len) * e.radius, y: c.y + (dy / len) * e.radius };
  const e2 = { x: c.x - (dx / len) * e.radius, y: c.y - (dy / len) * e.radius };
  return {
    constraintId, text,
    labelAnchor: target,
    dimensionLine: [e1, e2],
    extensionLines: [],
  };
}

/**
 * Angle between two lines. Drawn as an arc centered at the intersection,
 * radius = placement's distance from intersection. Extension lines along
 * each line direction from the intersection to where they meet the arc.
 */
function angleRender(
  constraintId: string, text: string,
  state: SketchState, la: LineEntity, lb: LineEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const a1 = findPoint(state, la.startId), a2 = findPoint(state, la.endId);
  const b1 = findPoint(state, lb.startId), b2 = findPoint(state, lb.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
  const i = intersectLines(a1, a2, b1, b2);
  if (!i) return null;
  const target = placement ?? { x: i.x + DEFAULT_OFFSET, y: i.y + DEFAULT_OFFSET };
  const arcRadius = Math.max(1, Math.hypot(target.x - i.x, target.y - i.y));
  // Unit direction along each line FROM the intersection toward the far end.
  const da = farUnit(i, a1, a2);
  const db = farUnit(i, b1, b2);
  // Arc endpoints — sampled along each line at the arc radius.
  const arcStart = { x: i.x + da.x * arcRadius, y: i.y + da.y * arcRadius };
  const arcEnd   = { x: i.x + db.x * arcRadius, y: i.y + db.y * arcRadius };
  // Bisector for the label placement, snapped onto the arc.
  const bx = da.x + db.x, by = da.y + db.y;
  const blen = Math.hypot(bx, by);
  const bisector = blen < 1e-9
    ? { x: i.x + arcRadius, y: i.y }
    : { x: i.x + (bx / blen) * arcRadius, y: i.y + (by / blen) * arcRadius };
  return {
    constraintId, text,
    labelAnchor: bisector,
    // We don't render arcs as the dim line yet — just a chord for now.
    // The two extension lines along the source lines convey orientation.
    dimensionLine: [arcStart, arcEnd],
    extensionLines: [
      [i, arcStart],
      [i, arcEnd],
    ],
  };
}

/** Perpendicular distance from point to line — same render as Distance
 * but with the line's direction supplying the orientation. */
function pointLineDistanceRender(
  constraintId: string, text: string,
  state: SketchState, p: PointEntity, l: LineEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const a = findPoint(state, l.startId);
  const b = findPoint(state, l.endId);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const t = ((p.x - a.x) * ux + (p.y - a.y) * uy);
  const foot = { x: a.x + ux * t, y: a.y + uy * t };
  const offset = placement
    ? (placement.x - foot.x) * nx + (placement.y - foot.y) * ny
    : DEFAULT_OFFSET;
  const pProj = { x: p.x + nx * offset, y: p.y + ny * offset };
  const fProj = { x: foot.x + nx * offset, y: foot.y + ny * offset };
  return {
    constraintId, text,
    labelAnchor: { x: (pProj.x + fProj.x) / 2, y: (pProj.y + fProj.y) / 2 },
    dimensionLine: [pProj, fProj],
    extensionLines: [[p, pProj], [foot, fProj]],
  };
}

// ── small geometry helpers ───────────────────────────────────────────────

function intersectLines(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): { x: number; y: number } | null {
  const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denom;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Unit vector from `from` toward whichever of `e1`,`e2` is farther — used
 * to orient the angle arc along the "outward" side of each line. */
function farUnit(
  from: { x: number; y: number },
  e1: { x: number; y: number }, e2: { x: number; y: number },
): { x: number; y: number } {
  const d1 = Math.hypot(e1.x - from.x, e1.y - from.y);
  const d2 = Math.hypot(e2.x - from.x, e2.y - from.y);
  const target = d2 > d1 ? e2 : e1;
  const dx = target.x - from.x, dy = target.y - from.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

// ── backwards-compat shim ────────────────────────────────────────────────

/** Legacy API — returns the label position only. Kept for any caller that
 * hasn't migrated to dimensionRenders yet. Internally just maps the rich
 * render result down to its label anchor. */
export interface DimensionLabel {
  constraintId: string;
  text: string;
  anchor: { x: number; y: number };
}

export function dimensionLabels(state: SketchState): DimensionLabel[] {
  return dimensionRenders(state).map(r => ({
    constraintId: r.constraintId,
    text: r.text,
    anchor: r.labelAnchor,
  }));
}
