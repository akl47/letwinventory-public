import type {
  SketchState, SketchConstraint, PointEntity, LineEntity, CircleEntity, ArcEntity,
  ConstraintType, SketchEntity,
} from './types';
import { findPoint, findEntity, onEdgeLookupKey } from './types';
import { angleQuadrant } from './geometry';
import { formatWithUnit, unitSymbol, type Unit } from './units';

/** Projected 2D endpoints of referenced model edges, keyed by the edge's
 * external-ref lookup key (same map the solver/determinacy consume). */
export type ExternalEdgeLines = Map<string, [{ x: number; y: number }, { x: number; y: number }]>;

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
  /** Angle dimensions render an ARC (between the two lines) instead of a
   * straight dimension line. center/radius + signed sweep from startAngle to
   * endAngle (radians, CCW). Arrowheads sit tangent at each end. */
  arc?: { center: { x: number; y: number }; radius: number; startAngle: number; endAngle: number };
  /** Arrowhead style: false/undefined = inside (default), true = outside. Copied
   * from the constraint's `arrowsOutside`. */
  arrowsOutside?: boolean;
  /** Label dragged past the dimension line's span (SolidWorks drag-past
   * behavior): solid leader from the nearest dim-line end out to the label.
   * The viewer trims the label end so the line doesn't run through the text. */
  labelLeader?: [{ x: number; y: number }, { x: number; y: number }];
  /** Set alongside labelLeader — the viewer flips the arrowheads outside
   * (pointing inward at the witness lines) like SolidWorks does when the
   * text no longer fits between them. */
  labelOutside?: boolean;
  /** Radius-style leader: single arrowhead at dimensionLine[0] (on the
   * curve), none at the label end. The viewer draws the horizontal
   * shoulder / landing segment into the text. */
  leader?: boolean;
  /** The measured curve behind a `leader` dim. The viewer re-derives the
   * exact arc tangency point from the pixel-sized bend location (bend ≠
   * label anchor once the text clearance + shoulder are applied), so the
   * radial segment stays collinear with the center. */
  curve?: { center: { x: number; y: number }; radius: number };
  /** Angle label dragged outside the measured span: extra arc segment
   * (same center/radius as `arc`) from the nearest span end out to the
   * label's angle. [fromAngle, toAngle]; the label sits at toAngle. */
  arcExtension?: [number, number];
}

const DIMENSIONAL_TYPES = new Set<ConstraintType>([
  'distance', 'radius', 'diameter', 'angle',
  'horizontal-distance', 'vertical-distance', 'point-line-distance', 'arc-length',
  'chord-distance', 'radial-distance',
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
    case 'chord-distance': return '— ' + num;
    case 'radial-distance': return 'ΔR ' + num;
    default: return num;
  }
}

void unitSymbol;  // kept for re-export consumers

export function dimensionRenders(
  state: SketchState, defaultUnit: Unit = 'mm', externalEdges?: ExternalEdgeLines,
): DimensionRender[] {
  const out: DimensionRender[] = [];
  for (const c of state.constraints) {
    if (!DIMENSIONAL_TYPES.has(c.type) || c.value === undefined) continue;
    // Chain-internal duplicates (added by offset to give the solver
    // enough equations for full constraint) omit `placement`. Skip
    // them — only the chain's ONE visible dim renders.
    if (c.chainId && !c.placement) continue;
    const r = renderConstraint(state, c, defaultUnit, externalEdges);
    if (r) { if (c.arrowsOutside) r.arrowsOutside = true; out.push(r); }
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

function renderConstraint(
  state: SketchState, c: SketchConstraint, defaultUnit: Unit, externalEdges?: ExternalEdgeLines,
): DimensionRender | null {
  // Point → model-edge distance: the "line" is a referenced model edge (no
  // sketch entity). Draw to its projected segment.
  if (c.type === 'point-line-distance' && c.externalRef) {
    const key = onEdgeLookupKey(c.externalRef);
    const line = key ? externalEdges?.get(key) : undefined;
    const p = findPoint(state, c.targets[0]?.entityId);
    if (!line || !p || c.value === undefined) return null;
    const text = formatDimensionText(c.type, c.value, c.unit, defaultUnit);
    const r = pointToSegmentDimRender(c.id, text, p, line[0], line[1], c.placement);
    if (!r) return null;
    return c.driven ? { ...r, text: `(${r.text})` } : r;
  }
  // Sketch-line ANGLE to a referenced model edge / datum line (REQ 886/907):
  // one line target + externalRef. Rendered EXACTLY like a two-line sketch
  // angle (arc at the intersection, quadrant from the placement) — the edge
  // just contributes its projected segment instead of a sketch entity.
  if (c.type === 'angle' && c.externalRef && c.targets.length === 1) {
    const key = onEdgeLookupKey(c.externalRef);
    const edge = key ? externalEdges?.get(key) : undefined;
    const l = findEntity(state, c.targets[0]?.entityId);
    if (!edge || !l || l.kind !== 'line' || c.value === undefined) return null;
    const s = findPoint(state, l.startId);
    const e = findPoint(state, l.endId);
    if (!s || !e) return null;
    const text = formatDimensionText(c.type, c.value, c.unit, defaultUnit);
    const r = angleRenderFromSegments(c.id, text, s, e, edge[0], edge[1], c.placement, c.angleRays);
    if (!r) return null;
    return c.driven ? { ...r, text: `(${r.text})` } : r;
  }
  const r = computeRender(
    state, c.id, c.type, c.targets.map(t => t.entityId), c.value!, c.placement, c.unit, defaultUnit, c.angleRays,
  );
  if (!r) return r;
  // Driven dim convention (SolidWorks-style): wrap the value text in
  // parentheses so the user can tell at a glance that this dim is
  // read-only / display-only. The renderer in cad-viewer additionally
  // applies a muted color when it sees a driven dim — colored render
  // logic doesn't belong here (this module is pure geometry).
  if (c.driven) return { ...r, text: `(${r.text})` };
  return r;
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
  angleRays?: [number, number],
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
    case 'radial-distance': {
      const inner = findEntity(state, targetIds[0]);
      const outer = findEntity(state, targetIds[1]);
      const ok = (x: SketchEntity | undefined): x is CircleEntity | ArcEntity =>
        !!x && (x.kind === 'circle' || x.kind === 'arc');
      if (!ok(inner) || !ok(outer)) return null;
      return radialDistanceRender(constraintId, text, state, inner, outer, placement);
    }
    case 'angle': {
      // 3-POINT vertex angle (REQ 890): [rayA, vertex, rayB]. Leader-style
      // render (like arc-length): label sits on the ray bisector just off
      // the vertex; no extension lines.
      if (targetIds.length === 3) {
        const pA = findPoint(state, targetIds[0]);
        const v = findPoint(state, targetIds[1]);
        const pB = findPoint(state, targetIds[2]);
        if (!pA || !v || !pB) return null;
        const a1 = Math.atan2(pA.y - v.y, pA.x - v.x);
        const a2 = Math.atan2(pB.y - v.y, pB.x - v.x);
        const mid = (a1 + a2) / 2;
        const labelAnchor = placement ?? {
          x: v.x + DEFAULT_OFFSET * 2 * Math.cos(mid),
          y: v.y + DEFAULT_OFFSET * 2 * Math.sin(mid),
        };
        return { constraintId, text, labelAnchor, dimensionLine: null, extensionLines: [] };
      }
      const a = findEntity(state, targetIds[0]);
      const b = findEntity(state, targetIds[1]);
      if (!a || a.kind !== 'line' || !b || b.kind !== 'line') return null;
      return angleRender(constraintId, text, state, a as LineEntity, b as LineEntity, placement, angleRays);
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
    case 'chord-distance': {
      // Render same as a 2-point distance between the arc's start and
      // end — the chord IS that segment. Reuses distanceRender so the
      // label drag / unit handling matches the rest of the dim family.
      const e = findEntity(state, targetIds[0]);
      if (!e || e.kind !== 'arc') return null;
      const start = findPoint(state, e.startId);
      const end = findPoint(state, e.endId);
      if (!start || !end) return null;
      return distanceRender(constraintId, text, start, end, placement, 'distance');
    }
  }
  return null;
}

// ── per-kind layout helpers ──────────────────────────────────────────────

/** SolidWorks-style label placement along a dimension line: the label
 * slides along the line's axis following the user's placement/drag.
 * Inside the span it rides the line (the viewer breaks the line around
 * the text); dragged past an end, the dim line grows a leader out to the
 * label and the arrowheads flip outside. No placement → midpoint. */
function slideLabelAlong(
  a: { x: number; y: number }, b: { x: number; y: number },
  placement: { x: number; y: number } | undefined,
): Pick<DimensionRender, 'labelAnchor' | 'labelLeader' | 'labelOutside'> {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (len < 1e-9 || !placement) return { labelAnchor: mid };
  const ux = dx / len, uy = dy / len;
  const t = (placement.x - a.x) * ux + (placement.y - a.y) * uy;
  const anchor = { x: a.x + ux * t, y: a.y + uy * t };
  if (t < 0) return { labelAnchor: anchor, labelLeader: [a, anchor], labelOutside: true };
  if (t > len) return { labelAnchor: anchor, labelLeader: [b, anchor], labelOutside: true };
  return { labelAnchor: anchor };
}

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
  return {
    constraintId, text, ...slideLabelAlong(aProj, bProj, placement),
    dimensionLine: [aProj, bProj],
    extensionLines: [[a, aProj], [b, bProj]],
  };
}

/**
 * Radius dimension. Leader from the curve's edge (at the angle pointing
 * toward the placement) out to the label anchor (slightly past the edge).
 * No witness lines — radius is conventionally drawn as a single leader.
 */
/** Radial gap between two concentric circles/arcs: a leader from the inner
 * radius to the outer radius along the placement direction, with extension
 * arcs implied by the two edges. Targets are [inner, outer]. */
function radialDistanceRender(
  constraintId: string, text: string,
  state: SketchState, inner: CircleEntity | ArcEntity, outer: CircleEntity | ArcEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const c = findPoint(state, inner.centerId);
  if (!c) return null;
  const rIn = Math.min(inner.radius, outer.radius);
  const rOut = Math.max(inner.radius, outer.radius);
  const target = placement ?? { x: c.x + rOut + DEFAULT_OFFSET, y: c.y };
  const dx = target.x - c.x, dy = target.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const innerEdge = { x: c.x + ux * rIn, y: c.y + uy * rIn };
  const outerEdge = { x: c.x + ux * rOut, y: c.y + uy * rOut };
  return {
    constraintId, text,
    labelAnchor: target,
    dimensionLine: [innerEdge, outerEdge],
    extensionLines: [],
    // Solid leader out to the label — not a witness line, so it must not
    // pick up the witness gap/overshoot treatment in the viewer.
    labelLeader: [outerEdge, target],
  };
}

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
    // SolidWorks radius convention: ONE arrowhead touching the arc, none
    // at the text; the viewer bends the leader into a horizontal shoulder.
    leader: true,
    curve: { center: { x: c.x, y: c.y }, radius: e.radius },
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
  // Text OUTSIDE the circle → SolidWorks/Onshape draw a single-arrow
  // radial leader with a shoulder (same layout as a radius dim, ⌀ text),
  // NOT a full line through the circle with an extension.
  if (len > e.radius) {
    return {
      constraintId, text,
      labelAnchor: target,
      dimensionLine: [e1, target],
      extensionLines: [],
      leader: true,
      curve: { center: { x: c.x, y: c.y }, radius: e.radius },
    };
  }
  // Text INSIDE → line edge-to-edge through the center, arrowheads at
  // both edges, label riding (and breaking) the line.
  return {
    constraintId, text, ...slideLabelAlong(e1, e2, target),
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
  angleRays?: [number, number],
): DimensionRender | null {
  const a1 = findPoint(state, la.startId), a2 = findPoint(state, la.endId);
  const b1 = findPoint(state, lb.startId), b2 = findPoint(state, lb.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
  return angleRenderFromSegments(constraintId, text, a1, a2, b1, b2, placement, angleRays);
}

/** Segment-coordinate core of {@link angleRender} — also used for the angle
 * to a referenced model edge / datum line (REQ 886/907), which has segment
 * endpoints but no sketch LineEntity. Renders identically to a two-line
 * sketch angle: arc at the intersection, quadrant from the placement. */
function angleRenderFromSegments(
  constraintId: string, text: string,
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
  placement: { x: number; y: number } | undefined,
  angleRays?: [number, number],
): DimensionRender | null {
  const i = intersectLines(a1, a2, b1, b2);
  if (!i) return null;
  const target = placement ?? { x: i.x + DEFAULT_OFFSET, y: i.y + DEFAULT_OFFSET };
  const arcRadius = Math.max(1, Math.hypot(target.x - i.x, target.y - i.y));
  // Rays bounding the measured quadrant. Prefer the stored orientation (locked
  // at first placement); else derive it from the current placement so the live
  // preview follows the cursor (interior vs exterior). Fall back to far-ends.
  let da: { x: number; y: number };
  let db: { x: number; y: number };
  const q = angleRays
    ? { rays: angleRays }
    : (placement ? angleQuadrant(a1, a2, b1, b2, placement) : null);
  if (q) {
    const [sA, sB] = q.rays;
    da = normVec({ x: sA * (a2.x - a1.x), y: sA * (a2.y - a1.y) });
    db = normVec({ x: sB * (b2.x - b1.x), y: sB * (b2.y - b1.y) });
  } else {
    // Unit direction along each line FROM the intersection toward the far end.
    da = farUnit(i, a1, a2);
    db = farUnit(i, b1, b2);
  }
  // Arc swept from line A to line B, going the SHORT way (the measured angle is
  // ≤ π between the far-directions). startAngle/endAngle in [-π,π]; pick the
  // signed sweep whose magnitude matches the angle between da and db.
  const startAngle = Math.atan2(da.y, da.x);
  let endAngle = Math.atan2(db.y, db.x);
  // Normalize so the sweep takes the minor arc (the one the bisector lies on).
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  endAngle = startAngle + delta;
  // Label rides the arc, following the placement's angular position (SW
  // drag behavior). No placement → the span's mid-angle (bisector).
  const labelAngle = placement
    ? Math.atan2(placement.y - i.y, placement.x - i.x)
    : startAngle + delta / 2;
  const labelAnchor = {
    x: i.x + arcRadius * Math.cos(labelAngle),
    y: i.y + arcRadius * Math.sin(labelAngle),
  };
  // Label dragged outside the measured span → extend the arc from the
  // nearest span end out to the label (the viewer draws it arrow-free).
  let arcExtension: [number, number] | undefined;
  const rel = wrapPi(labelAngle - startAngle);
  const inside = delta >= 0 ? rel >= 0 && rel <= delta : rel <= 0 && rel >= delta;
  if (!inside) {
    const relEnd = wrapPi(labelAngle - endAngle);
    arcExtension = Math.abs(rel) <= Math.abs(relEnd)
      ? [startAngle, startAngle + rel]
      : [endAngle, endAngle + relEnd];
  }
  // When the arc sits beyond a line's physical end, run an extension line
  // along the ray from the line's end out to the arc (drafting convention —
  // the dimension must visibly attach to the geometry it measures).
  const extensionLines: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  const addRayExtension = (
    ray: { x: number; y: number },
    e1: { x: number; y: number }, e2: { x: number; y: number },
  ) => {
    const reach = Math.max(
      0,
      (e1.x - i.x) * ray.x + (e1.y - i.y) * ray.y,
      (e2.x - i.x) * ray.x + (e2.y - i.y) * ray.y,
    );
    if (arcRadius > reach + 1e-9) {
      extensionLines.push([
        { x: i.x + ray.x * reach, y: i.y + ray.y * reach },
        { x: i.x + ray.x * arcRadius, y: i.y + ray.y * arcRadius },
      ]);
    }
  };
  addRayExtension(da, a1, a2);
  addRayExtension(db, b1, b2);
  return {
    constraintId, text,
    labelAnchor,
    // No chord — the arc itself conveys the angle.
    dimensionLine: null,
    extensionLines,
    arc: { center: { x: i.x, y: i.y }, radius: arcRadius, startAngle, endAngle },
    ...(arcExtension ? { arcExtension } : {}),
  };
}

/** Wrap an angle into (-π, π]. */
function wrapPi(x: number): number {
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Perpendicular distance from point to line. Two visual layouts:
 *   1. Plain point→line: dim line parallel to `l`, perpendicular witness
 *      lines from `p` and from p's foot on `l`.
 *   2. Line→line (parallel lines): when `p` is an endpoint of a line
 *      parallel to `l`, the layout flips to the SolidWorks convention
 *      for line-to-line — dim line PERPENDICULAR to the two lines at
 *      the user's chosen "along" position, with extension lines running
 *      ALONG each source line out to the dim line. */
/** Point → arbitrary 2D segment perpendicular-distance render. Same geometry as
 * pointLineDistanceRender but takes the segment endpoints directly (used for a
 * dimension to a referenced model edge, which has no sketch LineEntity). */
/**
 * Live PREVIEW render for a point/line → projected-edge dimension (between the
 * operand picks and the placement click). `pointId` is the sketch point (or a
 * line's start endpoint); `edge` is the projected edge's 2D segment; the value
 * is the measured perpendicular distance. Mirrors the committed render so the
 * preview matches the result.
 */
/** REQ 886/907 — THE single decision for "what dimension does this sketch
 * entity + referenced edge/datum line produce". The Smart-Dim live preview,
 * the Smart-Dim placement commit, and the relations-toolbar appliers all
 * consume this, so the hover, the committed constraint, and the toolbar can
 * never disagree (they historically did — each had its own copy).
 *   - point → perpendicular distance (point-line-distance)
 *   - line  → ANGLE between the lines; EXCEPT (near-)parallel, where the
 *             angle is degenerate and the meaning is the offset distance,
 *             measured from the line's start endpoint (SolidWorks semantics).
 */
export interface EdgeDimSpec {
  type: 'point-line-distance' | 'angle';
  /** Constraint target: the point id (distance) or the line id (angle).
   * Also the entity whose determinacy decides driven-ness. */
  targetId: string;
  /** Seed value: measured distance (sketch units) or angle (radians). */
  value: number;
}

export function resolveEdgeDim(
  state: SketchState,
  entity: SketchEntity,
  edge: [{ x: number; y: number }, { x: number; y: number }],
): EdgeDimSpec | null {
  const [a, b] = edge;
  const ex = b.x - a.x, ey = b.y - a.y;
  const elen = Math.hypot(ex, ey) || 1;
  const perp = (p: { x: number; y: number }) =>
    Math.abs(((p.x - a.x) * ey - (p.y - a.y) * ex) / elen);
  if (entity.kind === 'point') {
    return { type: 'point-line-distance', targetId: entity.id, value: perp(entity) };
  }
  if (entity.kind === 'line') {
    const s = findPoint(state, entity.startId);
    const e = findPoint(state, entity.endId);
    if (!s || !e) return null;
    const lx = e.x - s.x, ly = e.y - s.y;
    const cross = lx * ey - ly * ex;
    const parallel = Math.abs(cross) < 1e-3 * Math.hypot(lx, ly) * elen;
    if (parallel) return { type: 'point-line-distance', targetId: entity.startId, value: perp(s) };
    return { type: 'angle', targetId: entity.id, value: Math.abs(Math.atan2(cross, lx * ex + ly * ey)) };
  }
  return null;
}

/** Live PREVIEW of the dimension {@link resolveEdgeDim} decides for this
 * entity + edge — rendered with the same helpers the committed constraint
 * uses, so the hover always matches what the placement click will create. */
export function previewEdgeDimension(
  state: SketchState,
  entity: SketchEntity,
  edge: [{ x: number; y: number }, { x: number; y: number }],
  placement: { x: number; y: number },
  defaultUnit: Unit = 'mm',
): DimensionRender | null {
  const spec = resolveEdgeDim(state, entity, edge);
  if (!spec) return null;
  const text = formatDimensionText(spec.type, spec.value, undefined, defaultUnit);
  if (spec.type === 'angle') {
    const l = findEntity(state, spec.targetId);
    if (!l || l.kind !== 'line') return null;
    const s = findPoint(state, l.startId);
    const e = findPoint(state, l.endId);
    if (!s || !e) return null;
    return angleRenderFromSegments('__preview__', text, s, e, edge[0], edge[1], placement);
  }
  const p = findPoint(state, spec.targetId);
  if (!p) return null;
  return pointToSegmentDimRender('__preview__', text, p, edge[0], edge[1], placement);
}

function pointToSegmentDimRender(
  constraintId: string, text: string,
  p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const t = (p.x - a.x) * ux + (p.y - a.y) * uy;
  const foot = { x: a.x + ux * t, y: a.y + uy * t };
  const along = placement ? (placement.x - foot.x) * ux + (placement.y - foot.y) * uy : DEFAULT_OFFSET;
  const pProj = { x: p.x + ux * along, y: p.y + uy * along };
  const fProj = { x: foot.x + ux * along, y: foot.y + uy * along };
  return {
    constraintId, text, ...slideLabelAlong(pProj, fProj, placement),
    dimensionLine: [pProj, fProj],
    extensionLines: [[{ x: p.x, y: p.y }, pProj], [foot, fProj]],
  };
}

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
  const t = ((p.x - a.x) * ux + (p.y - a.y) * uy);
  const foot = { x: a.x + ux * t, y: a.y + uy * t };

  // Parallel-line case: render as line-to-line.
  const containing = findLineContainingPoint(state, p.id, l.id);
  if (containing && linesNearParallel(state, containing, l)) {
    const r = parallelLinesRender(constraintId, text, state, containing, l, p, placement);
    if (r) return r;
  }

  // Slide the dimension along the LINE direction (u), not the normal (n).
  // The measured gap p→foot is already along n, so offsetting along n would
  // put p, foot, and the dim line all on the same line — collapsing the
  // witness lines onto the dim line. Offsetting along u instead places the
  // perpendicular dim line off to the side, with witness lines running
  // parallel to the target line out to it (standard point-line dimension).
  const along = placement
    ? (placement.x - foot.x) * ux + (placement.y - foot.y) * uy
    : DEFAULT_OFFSET;
  const pProj = { x: p.x + ux * along, y: p.y + uy * along };
  const fProj = { x: foot.x + ux * along, y: foot.y + uy * along };
  return {
    constraintId, text, ...slideLabelAlong(pProj, fProj, placement),
    dimensionLine: [pProj, fProj],
    extensionLines: [[p, pProj], [foot, fProj]],
  };
}

/** Find a non-construction LineEntity in `state` that has `pointId` as
 * one of its endpoints. Excludes `excludeLineId` so we don't return the
 * dim's target line if the picked point happens to also be on it. */
function findLineContainingPoint(state: SketchState, pointId: string, excludeLineId: string): LineEntity | null {
  for (const e of state.entities) {
    if (e.kind !== 'line' || e.id === excludeLineId) continue;
    if (e.startId === pointId || e.endId === pointId) return e as LineEntity;
  }
  return null;
}

/** True when two lines' direction vectors are within ~0.5° of parallel
 * or anti-parallel. Mirrors the Smart-Dim detection in the editor. */
function linesNearParallel(state: SketchState, a: LineEntity, b: LineEntity): boolean {
  const a1 = findPoint(state, a.startId), a2 = findPoint(state, a.endId);
  const b1 = findPoint(state, b.startId), b2 = findPoint(state, b.endId);
  if (!a1 || !a2 || !b1 || !b2) return false;
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return false;
  const sinTheta = Math.abs(ax * by - ay * bx) / (la * lb);
  return sinTheta < Math.sin(0.5 * Math.PI / 180);
}

/** SolidWorks-style parallel-line distance dimension. The dim line is
 * PERPENDICULAR to the two lines at the "along" position implied by the
 * placement. The two extension lines run ALONG each source line from a
 * sensible attachment point on that line out to the dim line — so a
 * horizontal-line dimension shows horizontal extension lines and a
 * vertical dim line between them. Dragging the label moves the "along"
 * position; the dim length stays fixed (it's the gap between the
 * lines). */
function parallelLinesRender(
  constraintId: string, text: string,
  state: SketchState, l1: LineEntity, l2: LineEntity, picked: PointEntity,
  placement: { x: number; y: number } | undefined,
): DimensionRender | null {
  const a2 = findPoint(state, l2.startId);
  const b2 = findPoint(state, l2.endId);
  const a1 = findPoint(state, l1.startId);
  const b1 = findPoint(state, l1.endId);
  if (!a1 || !b1 || !a2 || !b2) return null;
  // Along/perp basis from l2 (l1 is parallel, equivalent choice).
  const dx = b2.x - a2.x, dy = b2.y - a2.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  // Project the placement onto l2's along-axis (origin = a2). Without
  // a placement, default to the picked point's projection plus a small
  // outward shift so the dim sits clear of the geometry.
  const projAlong = (px: number, py: number) =>
    ((px - a2.x) * ux + (py - a2.y) * uy);
  const t = placement
    ? projAlong(placement.x, placement.y)
    : projAlong(picked.x, picked.y) + DEFAULT_OFFSET;
  // Foot on l2 (where the dim line touches l2) and matching foot on l1.
  const footL2 = { x: a2.x + ux * t, y: a2.y + uy * t };
  // Signed perp distance from l2 to l1, using l1.startId as a reference
  // point on l1.
  const l1Offset = (a1.x - a2.x) * nx + (a1.y - a2.y) * ny;
  const footL1 = { x: footL2.x + nx * l1Offset, y: footL2.y + ny * l1Offset };
  // Extension lines: along each source line FROM whichever endpoint is
  // nearer the foot OUT to the foot itself. Picking the nearer endpoint
  // keeps the extension line short when the dim sits next to the line,
  // and grows naturally when the user drags the dim past the line's end.
  const nearerEndpoint = (line: LineEntity, foot: { x: number; y: number }) => {
    const s = findPoint(state, line.startId)!;
    const e = findPoint(state, line.endId)!;
    return Math.hypot(s.x - foot.x, s.y - foot.y) <= Math.hypot(e.x - foot.x, e.y - foot.y) ? s : e;
  };
  const attachL1 = nearerEndpoint(l1, footL1);
  const attachL2 = nearerEndpoint(l2, footL2);
  return {
    constraintId, text, ...slideLabelAlong(footL1, footL2, placement),
    dimensionLine: [footL1, footL2],
    extensionLines: [[attachL1, footL1], [attachL2, footL2]],
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
function normVec(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(v.x, v.y);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}

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
