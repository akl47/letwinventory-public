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
  | 'coincident'
  | 'fixed'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'point-on-line'
  | 'perpendicular'
  | 'parallel'
  | 'tangent'
  | 'equal'
  | 'symmetric'
  | 'midpoint'
  | 'concentric'
  | 'collinear';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  targets: ConstraintTarget[];
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

export interface ExtrudeFeature {
  id: FeatureId;
  type: 'extrude';
  sketchId: SketchId;
  distance: number;
  /** Missing == true. When false, feature is skipped during regenerateModel. */
  visible?: boolean;
}

export type Feature = OriginFeature | ExtrudeFeature;

export interface FeatureTree {
  features: Feature[];
  nextFeatureSeq: number;
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
