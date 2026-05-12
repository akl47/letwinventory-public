// Pure-data types for the CAD module. No framework dependencies.

// ──────────────────────────────────────────────────────────────────────────
// Sketch types
// ──────────────────────────────────────────────────────────────────────────

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  reference?: boolean;
}

export interface SketchLine {
  id: string;
  startId: string;
  endId: string;
  reference?: boolean;
}

export type ConstraintType =
  | 'coincident'
  | 'fixed'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'point-on-line';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  // Targets are primitive IDs. Shape varies per constraint:
  //   coincident: [pointId, pointId]
  //   fixed: [pointId]
  //   horizontal / vertical: [lineId]
  //   distance: [pointId, pointId]  with value
  //   point-on-line: [pointId, lineId]
  targets: string[];
  value?: number;
}

export interface SketchState {
  points: SketchPoint[];
  lines: SketchLine[];
  constraints: SketchConstraint[];
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
