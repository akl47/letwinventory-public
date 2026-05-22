// Pure-data types for the CAD module. No framework dependencies.

// ──────────────────────────────────────────────────────────────────────────
// Sketch entities — tagged union
// ──────────────────────────────────────────────────────────────────────────
// Every primitive carries a `kind` discriminator and an optional `construction`
// flag. Construction entities participate in constraint solving but are excluded
// from profile extraction (REQ 560).

export interface SketchEntityBase {
  id: string;
  construction?: boolean;
}

export interface PointEntity extends SketchEntityBase {
  kind: 'point';
  x: number;
  y: number;
}

export interface LineEntity extends SketchEntityBase {
  kind: 'line';
  startId: string;
  endId: string;
}

export interface CircleEntity extends SketchEntityBase {
  kind: 'circle';
  centerId: string;
  radius: number;
}

export interface ArcEntity extends SketchEntityBase {
  kind: 'arc';
  centerId: string;
  startId: string;
  endId: string;
  radius: number;
  ccw: boolean;
}

export interface EllipseEntity extends SketchEntityBase {
  kind: 'ellipse';
  centerId: string;
  majorAxisEndId: string;
  minorRadius: number;
}

export interface EllipticalArcEntity extends SketchEntityBase {
  kind: 'ellipticalArc';
  centerId: string;
  majorAxisEndId: string;
  minorRadius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
}

export interface SplineEntity extends SketchEntityBase {
  kind: 'spline';
  controlPointIds: string[];
  degree: number;
  // Uniform clamped knot vector derived from controlPointIds.length and degree.
}

export interface ConicEntity extends SketchEntityBase {
  kind: 'conic';
  conicType: 'parabola' | 'hyperbola';
  // Concrete parameter set deferred to Phase C.
  params: Record<string, number | string>;
}

export type SketchEntity =
  | PointEntity
  | LineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | EllipticalArcEntity
  | SplineEntity
  | ConicEntity;

// Backwards-compat type aliases for consumer convenience.
export type SketchPoint = PointEntity;
export type SketchLine = LineEntity;

// ──────────────────────────────────────────────────────────────────────────
// Constraints
// ──────────────────────────────────────────────────────────────────────────
// Per REQ 561, constraint targets are entity references — an entity id plus an
// optional subelement selector. Subelements name a meaningful point or curve on
// the entity (start, end, center, edge) without requiring a separate primitive.

export type ConstraintSubElement = 'start' | 'end' | 'center' | 'edge';

export interface ConstraintTarget {
  entityId: string;
  sub?: ConstraintSubElement;
}

export type ConstraintType =
  // `coincident` is the unified "this is on that" constraint and dispatches
  // on target entity kinds at solve time: (point, point), (point, line),
  // and (point, circle/arc/ellipse) are all valid. Earlier schemas split
  // this into 'point-on-line' / 'point-on-curve' — migration rewrites them
  // to `coincident` on load.
  | 'coincident'
  | 'fixed'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'perpendicular'
  | 'parallel'
  | 'tangent'
  | 'equal'
  | 'symmetric'
  | 'midpoint'
  | 'concentric'
  | 'coradial'           // geometric — two circles/arcs share both center AND radius
  | 'collinear'
  | 'radius'
  | 'diameter'
  | 'angle'
  | 'horizontal-distance'    // dimensional — driven Δx between two points
  | 'vertical-distance'      // dimensional — driven Δy between two points
  | 'point-line-distance'    // dimensional — driven perpendicular distance from point to line
  | 'arc-length';            // dimensional — driven arc length

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  targets: ConstraintTarget[];
  /** Optional 2D placement (in sketch-local coords) for dimensional
   * constraints. Set when the user clicks where the dimension line should
   * go (the third click in the SolidWorks-style Smart Dim flow). Used by
   * the renderer to draw the dimension line + extension lines at the
   * chosen offset from the measured geometry. Geometric constraints
   * (coincident, perpendicular, etc.) never set this. */
  placement?: { x: number; y: number };
  /** Optional per-dimension unit override (mm / um / in). When unset, the
   * dimension displays in the model's defaultUnit and bare numeric input
   * is interpreted in defaultUnit. When set, the dim shows the unit
   * suffix and its display uses this unit. `value` is ALWAYS stored in
   * mm regardless. */
  unit?: 'mm' | 'um' | 'in';
  value?: number;
}

export interface SketchState {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

// ──────────────────────────────────────────────────────────────────────────
// Entity helpers
// ──────────────────────────────────────────────────────────────────────────

export function pointsOf(state: SketchState): PointEntity[] {
  return state.entities.filter((e): e is PointEntity => e.kind === 'point');
}

export function linesOf(state: SketchState): LineEntity[] {
  return state.entities.filter((e): e is LineEntity => e.kind === 'line');
}

export function findEntity<E extends SketchEntity = SketchEntity>(
  state: SketchState, id: string,
): E | undefined {
  return state.entities.find(e => e.id === id) as E | undefined;
}

export function findPoint(state: SketchState, id: string): PointEntity | undefined {
  const e = findEntity(state, id);
  return e?.kind === 'point' ? e as PointEntity : undefined;
}

export function findLine(state: SketchState, id: string): LineEntity | undefined {
  const e = findEntity(state, id);
  return e?.kind === 'line' ? e as LineEntity : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Plane / sketch document
// ──────────────────────────────────────────────────────────────────────────

export interface Plane3 {
  origin: [number, number, number];
  xAxis: [number, number, number]; // in-plane basis vector 1 (unit)
  yAxis: [number, number, number]; // in-plane basis vector 2 (unit, perpendicular to xAxis)
  normal: [number, number, number]; // outward normal (unit)
}

export type SketchId = string;
export type HostId = string; // e.g. 'face:0' or 'datum:xy_plane'

export interface ReferenceCandidate {
  id: string;
  kind: 'vertex' | 'edge';
  // For vertex: a 2D point. For edge: two 2D endpoints.
  points: Array<{ x: number; y: number }>;
}

export interface Sketch {
  id: SketchId;
  hostId: HostId;
  plane: Plane3;
  state: SketchState;
  candidates: ReferenceCandidate[];
  /** Missing == true. When false, the 3D viewer omits this sketch's overlay. */
  visible?: boolean;
  /** REQ 624 — user-supplied label shown in the feature tree. */
  name?: string;
}

export interface SketchDocument {
  sketches: Record<SketchId, Sketch>;
  nextSketchSeq: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Feature tree
// ──────────────────────────────────────────────────────────────────────────

export type FeatureId = string;

export interface OriginFeature {
  id: FeatureId;
  type: 'origin';
  /**
   * Per-datum-element visibility. Keys: 'origin' | 'x_axis' | 'y_axis' | 'z_axis'
   * | 'xy_plane' | 'yz_plane' | 'xz_plane'. Missing keys default to true.
   */
  visibility?: Record<string, boolean>;
}

/** SolidWorks-style extrude end conditions. The tag drives backend
 * translation in cadRegenService — each kind resolves to a kernel call
 * (or, for booleans-based variants, a sentinel + post-trim).
 *
 * - blind: extrude a fixed distance along the normal.
 * - midPlane: extrude `distance` centred on the sketch plane (so each
 *   side gets distance/2). Backend shifts plane.origin by -normal·d/2
 *   before dispatch; no kernel change needed.
 * - throughAll: extrude a sentinel-large distance (10000 units). When
 *   subtractive booleans land it will be intersected with the body.
 * - upToVertex: extrude until the perpendicular distance to a picked
 *   vertex. Backend resolves the vertex's world position from the
 *   topology cache, computes the distance, dispatches as Blind.
 * - upToSurface / upToBody: requires kernel boolean ops; UI shows the
 *   picker but commit is gated until Pass 3-4. */
export type ExtrudeEndCondition =
  | { kind: 'blind' }
  | { kind: 'midPlane' }
  | { kind: 'throughAll' }
  | { kind: 'upToVertex'; vertexId: string }
  | { kind: 'upToSurface'; faceId: string }
  | { kind: 'upToBody'; featureId: string };

export interface ExtrudeFeature {
  id: FeatureId;
  type: 'extrude';
  sketchId: SketchId;
  /** Extrusion length in mm. For Mid Plane this is the FULL thickness
   * (each side gets half). Ignored for Through All / Up to *
   * conditions, but kept on the feature so toggling back to Blind
   * doesn't lose the user's last value. */
  distance: number;
  /** Missing == true. When false, feature is skipped during regenerateModel. */
  visible?: boolean;
  /** Missing == false. When true, the extrude grows along -plane.normal.
   * Applies to Blind, Through All, and Up to * conditions (it flips the
   * extrusion direction). Mid Plane ignores it (symmetric). */
  flipped?: boolean;
  /** End condition. Missing == { kind: 'blind' } for backwards compat
   * with features persisted before the field existed. */
  endCondition?: ExtrudeEndCondition;
  /**
   * Which planar regions of the sketch this feature extrudes. Indices into
   * extractRegions(sketch.state).regions in stable order. Each region is
   * one outer loop with 0..N inner holes (so a region picked off a sketch
   * of two concentric circles can be the inner disk, the outer disk, or
   * the donut between them). Missing == [0] for backwards compat.
   *
   * Legacy: this field was `loopIndices` before regions existed. Saved
   * docs carrying the old field are remapped to `regionIndices` on load
   * (see migration.ts) — for non-nested sketches the indices line up.
   */
  regionIndices?: number[];
  /** REQ 624 — user-supplied label shown in the feature tree. */
  name?: string;
}

export type Feature = OriginFeature | ExtrudeFeature;

export interface FeatureTree {
  features: Feature[];
  nextFeatureSeq: number;
  /** Default display unit for dimensions in this CAD model. Bare numeric
   * input from the user is interpreted in this unit. Per-dimension overrides
   * are stored on the individual constraint. Defaults to 'mm' when unset
   * (legacy models). */
  defaultUnit?: 'mm' | 'um' | 'in';
}

// ──────────────────────────────────────────────────────────────────────────
// Datum elements (output of the origin feature)
// ──────────────────────────────────────────────────────────────────────────

export type DatumKind = 'point' | 'axis' | 'plane';

export interface DatumElement {
  id: string; // stable: 'origin' | 'x_axis' | … | 'xy_plane' | …
  kind: DatumKind;
  // For axis: direction unit vector. For plane: normal unit vector.
  // For point: ignored.
  direction?: [number, number, number];
}

// ──────────────────────────────────────────────────────────────────────────
// Resolved model geometry (consumed by the renderer)
// ──────────────────────────────────────────────────────────────────────────

export interface FaceMesh {
  faceId: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** REQ 623 — feature this face belongs to. Set by featureTree.regenerateModel
   * after the kernel returns; absent on origin-derived geometry. */
  featureId?: string;
  /** REQ 625 — true when every triangle in this face shares one normal. Set by
   * the kernel adapter (cap = true, polygon side = true, curved side = false). */
  isFlat?: boolean;
}

export interface ModelTopology {
  vertices: Array<{ id: string; position: [number, number, number] }>;
  edges: Array<{ id: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]] }>;
}

export interface ModelGeometry {
  datums: DatumElement[];
  faces: FaceMesh[];
  topology: ModelTopology;
}

export interface RegenerateResult {
  geometry: ModelGeometry;
  errors: string[];
}
