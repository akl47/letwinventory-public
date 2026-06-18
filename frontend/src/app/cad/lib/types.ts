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
  // SolidWorks-style Convert Entities link is no longer a field — it
  // now lives as an `on-edge` SketchConstraint that targets the entity
  // and carries the externalRef to the source body edge. See
  // `isProjectedEntity` / `findOnEdgeConstraint` below.
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
  // REQ 597 — Parabola defined by vertex + focus + endpoint sample.
  // (Hyperbola placeholder kept for future expansion.)
  /** Point ids — meaning depends on `conicType`. For parabola:
   *  [0] = vertex, [1] = focus, [2] = sample point on the curve.
   *  The curve is tessellated symmetrically from −t .. +t where
   *  t is set so the curve passes through the sample point. */
  pointIds: string[];
}

/** REQ — Batch 6 — Text with a dimensionable bounding box. The four
 * corners are real `PointEntity` records linked by four construction
 * `LineEntity` lines (OnShape style); the user can dimension and
 * constrain those lines like any other sketch geometry, and the
 * text scales to fit the resulting rectangle. Corner order:
 * BL, BR, TR, TL (CCW from bottom-left).
 *
 * Legacy text entities used (anchorId, size) — the renderer falls
 * back to that shape when `cornerIds` is missing so existing
 * sketches keep loading. */
export interface TextEntity extends SketchEntityBase {
  kind: 'text';
  text: string;
  /** 4 point ids: BL, BR, TR, TL. New text entities use this; the
   * box height drives font height and the width caps visible text. */
  cornerIds?: [string, string, string, string];
  /** Horizontal alignment within the construction box. Defaults to 'left'. */
  justify?: 'left' | 'center' | 'right';
  /** Font face. 'outline' = filled Roboto glyph outlines (extrudable, default);
   * 'singleLine' = single-stroke engraving font (open strokes, for V-carve /
   * engraving — not a closed region, so it doesn't extrude into a solid). */
  font?: 'outline' | 'singleLine';
  /** Mirror the glyphs horizontally within the box (reversed text — e.g. for
   * back-side engraving / stamps). The box constraints are unaffected. */
  mirror?: boolean;
  /** Rotate the glyphs within the box, in degrees CCW about the box centre.
   * The box (and its horizontal/vertical constraints) stays put. Defaults 0. */
  rotation?: number;
  /** Legacy anchor — kept for back-compat. New entities don't use it. */
  anchorId?: string;
  /** Legacy size — kept for back-compat. */
  size?: number;
}

/** REQ — Batch 6 — Sketch Picture. A raster image inserted as
 * reference geometry: positioned, scaled, rotated; participates in
 * picking only as a background (not extruded). Stored as a base64
 * data URL so the sketch document is self-contained. */
export interface PictureEntity extends SketchEntityBase {
  kind: 'picture';
  anchorId: string;          // lower-left anchor point id
  /** Image source: data URL (preferred, self-contained) or http URL. */
  src: string;
  /** Width/height in sketch units (mm). Aspect can deviate from
   * the source's pixel aspect; the user sets both independently. */
  width: number;
  height: number;
  /** Rotation about the anchor, radians, CCW. */
  rotation: number;
  /** Display opacity (0..1) so the user can fade the image while
   * tracing. */
  opacity: number;
}

/** REQ — Batch 6 — Equation curve. Parametric x(t), y(t) over
 * [tMin, tMax]. Expressions are simple JS arithmetic + Math.*. The
 * tessellator samples at `samples` evenly-spaced t values. */
export interface EquationCurveEntity extends SketchEntityBase {
  kind: 'equation';
  xExpr: string;             // expression in `t` (e.g. "5*Math.cos(t)")
  yExpr: string;             // expression in `t`
  tMin: number;
  tMax: number;
  samples: number;           // 8..2000; clamped at evaluation
}

/** REQ — Batch 6 — Intersection curve. Geometric curve formed by
 * intersecting an existing body's faces with the host sketch plane.
 * Tessellated by walking face meshes; recomputed on regen the same
 * way Convert Entities re-runs. */
export interface IntersectionCurveEntity extends SketchEntityBase {
  kind: 'intersection';
  /** Body id whose faces are intersected with the sketch plane. */
  sourceBodyId: string;
}

/** REQ — Batch 6 — Spline-on-surface. A 3D spline whose control
 * points live in (u, v) parameter space of a face; tessellated and
 * projected onto the face during render. Storage-only for v1: the
 * face uv space + control-point packing matches Onshape's
 * surface-spline storage shape so we can swap in a real tessellator
 * later without a migration. */
export interface SplineOnSurfaceEntity extends SketchEntityBase {
  kind: 'splineOnSurface';
  faceId: string;            // face this spline lives on
  /** (u, v) control points in the face's parameter space, 0..1. */
  uvControlPoints: Array<{ u: number; v: number }>;
  degree: number;
}

export type SketchEntity =
  | PointEntity
  | LineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | EllipticalArcEntity
  | SplineEntity
  | ConicEntity
  | TextEntity
  | PictureEntity
  | EquationCurveEntity
  | IntersectionCurveEntity
  | SplineOnSurfaceEntity;

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
  | 'arc-length'             // dimensional — driven arc length
  | 'chord-distance'         // dimensional — driven straight-line distance between an arc's endpoints
  | 'radial-distance'        // dimensional — driven radial gap between two concentric circles/arcs (r_outer − r_inner). targets [inner, outer]
  // `on-edge` is the SolidWorks "Convert Entities" link constraint — it
  // pins a sketch entity (line / arc / circle) onto the projection of a
  // 3D body edge identified by `externalRef`. The entity itself is a
  // plain line/arc/circle with no special storage; deleting this
  // constraint "breaks the link" so the entity becomes a normal
  // sketched entity. The re-projection loop updates the target
  // entity's points each regen from the source edge's polyline.
  | 'on-edge';

/** The geometry an `on-edge` constraint is locked onto. A discriminated union:
 *  - `local` (default) — an edge of THIS part's own topology (the existing
 *    intra-part Convert Entities behavior). `scope` may be omitted on legacy
 *    docs; migration backfills it to 'local'.
 *  - `cross-part` — geometry belonging to ANOTHER part, positioned by how the
 *    two parts are mated in a defining assembly (REQ 770/771). The relative
 *    transform is resolved live from that assembly's mate solve; a cached
 *    snapshot (`cachedProjection`) is used for standalone regen, and the source
 *    part's commit is pinned at check-in (`pinnedSourceCommit`) for reproducible
 *    history. The projected entity stays a plain line/arc/circle. */
export type ExternalRef =
  | {
      scope?: 'local';
      /** Feature whose featureId-namespaced topology owns the source edge/vertex. */
      featureId: string;
      /** Topology edge id (kernel-assigned, namespaced by body). Present for an
       * edge reference (Convert Entities, or a sketch point riding the edge). */
      edgeId?: string;
      /** Topology vertex id. Present for a vertex reference — a single sketch
       * point pinned to the projection of a model vertex (no edge involved). */
      vertexId?: string;
      /** Sub-element of the referenced `edgeId`. `'center'` (REQ 830–832) pins
       * the target point to the projected CENTER of a circular/arc model edge —
       * concentric for a circle/arc placed by its center, coincident-to-center
       * for a standalone point. Re-derived from the edge's polyline each regen.
       * Absent → the point rides the edge line (the existing on-edge behavior). */
      sub?: 'center';
    }
  | {
      scope: 'cross-part';
      /** DesignAssembly that positions the source part (the defining assembly). */
      definingAssemblyId: number;
      /** That assembly's VCS repo lineage-root id. */
      definingAssemblyRepoId: string;
      /** The source component instance within the defining assembly. */
      sourceInstanceId: string;
      /** The source Part's id (resolver convenience + impact analysis). */
      sourcePartId: number;
      /** The geometry on the source part being projected. */
      sourceGeomRef: { featureId: string; edgeId?: string; faceId?: string; vertexId?: string };
      /** Fallback geometry (in the SOURCE part's local frame) used to
       * re-resolve `sourceGeomRef` when the source topology renumbers. */
      fallback?:
        | { kind: 'edge'; start: [number, number, number]; end: [number, number, number] }
        | { kind: 'face'; centroid: [number, number, number]; normal: [number, number, number]; surfaceKind: string }
        | { kind: 'vertex'; position: [number, number, number] };
      /** The source part's commit, pinned at the dependent part's check-in so
       * historical/released revisions reproduce exactly. Null in the working copy. */
      pinnedSourceCommit?: string | null;
      /** Last-resolved snapshot, used for standalone (out-of-assembly) regen.
       * `edges` are the source geometry expressed in THIS part's local 3D frame;
       * the existing projection step re-derives the 2D from them every regen. */
      cachedProjection?: {
        resolvedAt?: number;
        relPlacement?: { translate: [number, number, number]; quaternion: [number, number, number, number] };
        edges?: Array<{ polyline: Array<[number, number, number]> }>;
        stale?: boolean;
      };
    };

/** The key under which an `on-edge` constraint's referenced edge is found in
 * an `externalEdges` map (solver / determinacy / projection): the topology
 * edgeId for a local ref, or the synthetic stable id stored in
 * `sourceGeomRef.edgeId` for a cross-part ref. Null when there's no edge ref
 * (e.g. a vertex ref). Shared so solver and determinacy stay in lockstep. */
export function onEdgeLookupKey(ref: ExternalRef | undefined): string | null {
  if (!ref) return null;
  if (ref.scope === 'cross-part') return ref.sourceGeomRef?.edgeId ?? null;
  return ref.edgeId ?? null;
}

/** True when the ref is a local arc/circle CENTER reference (REQ 831/832): a
 * `concentric` / `coincident` (or legacy `on-edge`) constraint that pins its
 * target point to the projected edge center. Narrows the union so callers can
 * branch without re-checking `scope`. */
export function isCenterExternalRef(ref: ExternalRef | undefined): boolean {
  return !!ref && ref.scope !== 'cross-part' && ref.sub === 'center';
}

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
  /** True when the dim is "driven" — it reads the current geometry
   * back rather than driving it. The solver skips driven dims; the
   * renderer shows them in a muted color with parentheses around the
   * value. Mirrors SolidWorks's driven/driving dimension distinction. */
  driven?: boolean;
  /** External reference for the `on-edge` constraint — identifies the
   * 3D body edge that the target sketch entity is locked onto. Re-
   * projection consumes this each regen to recompute the entity's
   * point coordinates from the source edge's polyline. Absent on every
   * other constraint type. */
  externalRef?: ExternalRef;
  /** Groups auto-generated constraints emitted as a batch (chain
   * offset, etc.) so the editor can treat them as one logical unit:
   *   - the constraint list hides chain-internal duplicates,
   *   - editing one dim value propagates to every constraint with
   *     the same chainId,
   *   - deleting one removes the whole group.
   * Absent on user-authored constraints. */
  chainId?: string;
}

/** True when any `on-edge` constraint in the sketch targets `entityId`.
 * Read-side helper used by the viewer (styling), solver (point pins),
 * determinacy (DOF accounting), and break-link UI. Plain function so
 * any consumer can call it without dragging in component state. */
export function isProjectedEntity(state: SketchState, entityId: string): boolean {
  for (const c of state.constraints) {
    if (c.type !== 'on-edge') continue;
    for (const t of c.targets) {
      if (t.entityId === entityId) return true;
    }
  }
  return false;
}

/** Find the on-edge constraint that targets `entityId`, or null. Used
 * by re-projection and break-link to read the source edge reference. */
export function findOnEdgeConstraint(state: SketchState, entityId: string): SketchConstraint | null {
  for (const c of state.constraints) {
    if (c.type !== 'on-edge') continue;
    for (const t of c.targets) {
      if (t.entityId === entityId) return c;
    }
  }
  return null;
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
  kind: 'vertex' | 'edge' | 'center';
  // For vertex/center: a single 2D point. For edge: a 2D polyline (≥2 points;
  // a straight edge is its two endpoints, a curved edge its projected samples).
  points: Array<{ x: number; y: number }>;
  /** Present when this candidate is ANOTHER component's edge, projected into
   * the host part's sketch plane while editing in-context. Carries everything
   * needed to build a cross-part on-edge ExternalRef (resolved by the backend
   * via the fallback endpoint geometry) and to key the edge's live projection
   * for the solver / determinacy. */
  crossPart?: {
    definingAssemblyId: number;
    definingAssemblyRepoId: string;
    sourceInstanceId: string;
    sourcePartId: number;
    /** Edge endpoints in the source part's local frame (resolver fallback). */
    sourceStart: [number, number, number];
    sourceEnd: [number, number, number];
    /** Stable id stored on the ref + used as the externalEdges lookup key. */
    stableId: string;
  };
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
  /** Unified creation timestamp (ms since epoch). Shares scale with
   * Feature.createdAt so the tree can interleave orphan sketches with
   * features by chronological order. Missing on legacy docs — the
   * migration backfills based on relative position in the feature tree. */
  createdAt?: number;
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
  /** Creation timestamp — see Sketch.createdAt. Origin is always 0
   * so it sorts to the top of the feature tree regardless of when the
   * model was created. */
  createdAt?: number;
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
  | {
      kind: 'upToSurface';
      faceId: string;
      /** Centroid + outward normal of the picked face, captured at pick
       * time from the rendered geometry. Used by the backend as a
       * fallback resolution path when the persistent faceId can't be
       * found in any upstream feature (proper topological naming is
       * deferred — see boolean re-tagging on merge). The fallback is
       * geometry-only so it can go stale if upstream features shift the
       * face; the user re-picks in that case. */
      fallbackPlane?: { origin: [number, number, number]; normal: [number, number, number] };
    }
  | {
      /** Extrude up to a plane parallel to the picked face, offset
       * by `offset` along the face's outward normal. Positive offset =
       * past the face (away from the body); negative = before the face.
       * Same fallback semantics as upToSurface. */
      kind: 'offsetFromSurface';
      faceId: string;
      offset: number;
      fallbackPlane?: { origin: [number, number, number]; normal: [number, number, number] };
    }
  | {
      /** Extrude up to a target BODY: the end face conforms to the body's
       * real surface (curved/angled supported), via the kernel's
       * prism-until-body op. The user picks any face of the target body in the
       * viewer; `bodyId` is the owning body resolved at pick time (stable
       * across regens and face re-tagging — a raw faceId is not, because a
       * face this very feature contributes won't exist yet at its own regen).
       * The backend matches `bodyId` against the live body list and hands that
       * body's BREP to the kernel. `faceId` is kept only for the editor's
       * re-pick indicator. */
      kind: 'upToBody';
      bodyId: string;
      faceId?: string;
    }
  | {
      /** Extrude up to the NEXT body encountered along the direction — no
       * target pick. The backend hands the kernel every upstream body; the
       * kernel subtracts them all and caps the result at whichever surface the
       * profile reaches first. The end conforms to that real surface. */
      kind: 'upToNext';
    };

/** SolidWorks-style start condition. Decides WHERE the extrude profile
 * begins along the plane normal. Missing == { kind: 'sketchPlane' } for
 * backwards-compat (the historical default).
 *   - sketchPlane: profile sits on the sketch's host plane. Default.
 *   - offset: profile is translated by `distance` along the plane
 *     normal before extruding. Negative distance moves opposite the
 *     normal direction.
 *   - upToVertex / upToSurface: profile is projected to the vertex's
 *     or face's z-coord along the plane normal. Kernel-side resolution
 *     in a later pass; preview/UI accept these now. */
export type ExtrudeStartCondition =
  | { kind: 'sketchPlane' }
  | { kind: 'offset'; distance: number }
  | { kind: 'upToVertex'; vertexId: string }
  | {
      kind: 'upToSurface';
      faceId: string;
      /** Geometry captured at pick time so the backend can resolve the
       * start plane even when the persistent faceId has been re-tagged
       * by a boolean merge upstream. Same fallback path the
       * end-condition's upToSurface uses. */
      fallbackPlane?: { origin: [number, number, number]; normal: [number, number, number] };
    }
  | {
      /** Start the profile from a plane parallel to the picked face,
       * offset by `offset` along the face's outward normal. */
      kind: 'offsetFromSurface';
      faceId: string;
      offset: number;
      fallbackPlane?: { origin: [number, number, number]; normal: [number, number, number] };
    };

/** One direction of an extrude — its own length + end condition.
 * Direction 1 uses the same field for backwards-compat (top-level
 * `distance` / `endCondition`); Direction 2 is optional and lives in
 * `direction2` below. */
export interface ExtrudeDirection {
  distance: number;
  endCondition: ExtrudeEndCondition;
}

export interface ExtrudeFeature {
  id: FeatureId;
  type: 'extrude';
  sketchId: SketchId;
  /** Extrusion length in mm. For Mid Plane this is the FULL thickness
   * (each side gets half). Ignored for Through All / Up to *
   * conditions, but kept on the feature so toggling back to Blind
   * doesn't lose the user's last value. */
  distance: number;
  /** Missing == true. When false, feature is hidden in the viewer. */
  visible?: boolean;
  /** SolidWorks-style suppression. When true, the feature is skipped
   * entirely during regen — as if it didn't exist. Downstream features
   * compose against the body state BEFORE this feature. Distinct from
   * visibility: a hidden feature still computes (so downstream features
   * see its contribution); a suppressed feature doesn't. */
  suppressed?: boolean;
  /** Missing == false. When true, the extrude grows along -plane.normal.
   * Applies to Blind, Through All, and Up to * conditions (it flips the
   * extrusion direction). Mid Plane ignores it (symmetric). */
  flipped?: boolean;
  /** End condition for direction 1. Missing == { kind: 'blind' } for
   * backwards-compat with features persisted before the field existed. */
  endCondition?: ExtrudeEndCondition;
  /** Where the extrude profile starts along the plane normal. Missing
   * == { kind: 'sketchPlane' } for backwards-compat. */
  startCondition?: ExtrudeStartCondition;
  /** Optional second direction. When set, the extrude grows in BOTH
   * directions from the profile: direction 1 along the plane normal
   * (subject to `flipped`), direction 2 along the opposite normal,
   * each with its own length + end condition. Missing == single
   * direction (the historical behaviour). */
  direction2?: ExtrudeDirection;
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
  /** SolidWorks-style "Merge result" toggle. Missing == true. When false,
   * the extrude produces a NEW body instead of fusing into the most-recent
   * existing body — that's how you build multi-body parts. The new body's
   * id is this feature's id. */
  merge?: boolean;
  /** REQ 624 — user-supplied label shown in the feature tree. */
  name?: string;
  /** Creation timestamp — see Sketch.createdAt. */
  createdAt?: number;
}

/** Subtractive extrude — sketched profile is extruded into a prism and
 * cut from the cumulative body. Shares every field with ExtrudeFeature
 * (sketch / regions / distance / flipped / endCondition); only the
 * 'type' tag and the backend dispatch differ. Requires at least one
 * additive feature upstream — there's nothing to cut FROM otherwise. */
export interface CutExtrudeFeature {
  id: FeatureId;
  type: 'cutExtrude';
  sketchId: SketchId;
  distance: number;
  visible?: boolean;
  /** SolidWorks-style suppression — see ExtrudeFeature.suppressed. */
  suppressed?: boolean;
  flipped?: boolean;
  endCondition?: ExtrudeEndCondition;
  /** Same semantics as ExtrudeFeature.startCondition. */
  startCondition?: ExtrudeStartCondition;
  /** Same semantics as ExtrudeFeature.direction2. */
  direction2?: ExtrudeDirection;
  regionIndices?: number[];
  name?: string;
  /** Creation timestamp — see Sketch.createdAt. */
  createdAt?: number;
}

/** Rotate a sketched profile around a sketched-line axis. Same
 * cumulative-body composition as Extrude (additive): the produced
 * solid of revolution fuses into the running body. Cut-revolves are a
 * future extension. */
export interface RevolveFeature {
  id: FeatureId;
  type: 'revolve';
  sketchId: SketchId;
  /** Sketched line entity id inside the same sketch — its two endpoints
   * define the rotation axis in 2D (which the backend projects to 3D
   * via the sketch plane). Construction lines are explicit reference
   * geometry and are the natural axis choice, but any non-construction
   * line works too. */
  axisLineId: string;
  /** Revolution angle in degrees. 360 = full revolve. */
  angle: number;
  /** Reverse rotation direction. Missing == false. Flips the sign of
   * the axis vector before dispatch. */
  flipped?: boolean;
  /** SolidWorks-style "Merge result" toggle. Missing == true. See
   * `ExtrudeFeature.merge` for semantics. */
  merge?: boolean;
  visible?: boolean;
  /** SolidWorks-style suppression — see ExtrudeFeature.suppressed. */
  suppressed?: boolean;
  regionIndices?: number[];
  name?: string;
  /** Creation timestamp — see Sketch.createdAt. */
  createdAt?: number;
}

/** Subtractive revolve — same sketched profile + axis line as RevolveFeature,
 * but the body of revolution is BOOLEAN-SUBTRACTED from the cumulative body
 * instead of fused. Requires at least one additive feature upstream — there's
 * nothing to cut FROM otherwise. Cut Revolve has no `merge` flag (cuts always
 * subtract). */
export interface CutRevolveFeature {
  id: FeatureId;
  type: 'cutRevolve';
  sketchId: SketchId;
  axisLineId: string;
  angle: number;
  flipped?: boolean;
  visible?: boolean;
  suppressed?: boolean;
  regionIndices?: number[];
  name?: string;
  createdAt?: number;
}

/** Sketched 2D profile dragged along a 3D path to produce a solid. The
 * path is itself a sketch — its non-construction line/arc/circle segments
 * are chained into a single wire and projected to 3D via the sketch's
 * plane. Profile and path live on different sketches; a profile coplanar
 * with the path's tangent at its start point will fail in the kernel
 * ("profile parallel to path"). Same `merge` semantics as ExtrudeFeature. */
export interface SweepFeature {
  id: FeatureId;
  type: 'sweep';
  /** Sketch holding the closed 2D profile that gets swept. */
  profileSketchId: SketchId;
  /** Sketch holding the path. The path's segments are walked in chain
   * order (endpoint coincidence) and the resulting wire projected via
   * the sketch's plane. Open and closed paths both work. */
  pathSketchId: SketchId;
  /** Which closed region of the profile sketch to sweep. Missing == [0]. */
  regionIndices?: number[];
  /** SolidWorks-style "Merge result" toggle. Missing == true. Same
   * semantics as ExtrudeFeature.merge — false produces a free-floating
   * body that does not fuse with the cumulative shape. */
  merge?: boolean;
  visible?: boolean;
  /** SolidWorks-style suppression — see ExtrudeFeature.suppressed. */
  suppressed?: boolean;
  name?: string;
  /** Creation timestamp — see Sketch.createdAt. */
  createdAt?: number;
}

/** Subtractive sweep — same profile+path pair as SweepFeature, but the
 * swept solid is BOOLEAN-SUBTRACTED from the cumulative body instead of
 * fused. Requires at least one additive feature upstream. */
export interface CutSweepFeature {
  id: FeatureId;
  type: 'cutSweep';
  profileSketchId: SketchId;
  pathSketchId: SketchId;
  regionIndices?: number[];
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** One edge target on the host body for a fillet/chamfer. Identity is
 * stored as world-space endpoint coordinates rather than the topology
 * edge id — endpoint geometry is robust to OCCT's per-call edge
 * re-numbering across booleans. The kernel matches each EdgeRef to a
 * body edge by closest-endpoint sum (in either pairing) within a small
 * tolerance. */
export interface EdgeRef3D {
  start: [number, number, number];
  end: [number, number, number];
  /** Optional per-edge value override (radius for fillet, distance
   * for chamfer). When present, overrides the feature-level default
   * for this edge only — supports SolidWorks multi-radius fillets and
   * mixed-distance chamfers in a single feature. */
  value?: number;
  /** Source face id when this edge was picked via face-expansion
   * (clicking the face adds every boundary edge tagged with the face's
   * id). Drives the sidebar's "Face N" row grouping; doesn't affect
   * kernel behaviour. Plain edge picks leave this undefined. */
  faceId?: string;
  /** Source edge group when tangent propagation expanded one click
   * into multiple edges (the seed plus its tangent-continuous
   * neighbors). All edges from one click share the seed's edgeId
   * here. Drives the sidebar's "Edge N" row grouping (show one row
   * for the whole chain). Single-edge picks without expansion leave
   * this undefined. Doesn't affect kernel behaviour. */
  edgeGroupId?: string;
}

/** SolidWorks-style 3D fillet — round one or more edges of the host body
 * with a constant radius. Variable-radius and face-fillet are deferred. */
export interface FilletFeature {
  id: FeatureId;
  type: 'fillet';
  edges: EdgeRef3D[];
  radius: number;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** SolidWorks-style 3D chamfer. Three modes:
 *   - 'equal'         — single distance, applied symmetrically (45° bevel).
 *   - 'twoDistance'   — two distances, asymmetric. `distance` is the
 *                       primary leg, `distance2` the secondary; the
 *                       reference face the angle bisects is the first
 *                       adjacent face the kernel discovers.
 *   - 'distanceAngle' — one distance plus an angle (in degrees) measured
 *                       FROM the reference face. `distance` is the leg,
 *                       `angle` the angle.
 * Mode defaults to 'equal' on legacy records (missing field). */
export interface ChamferFeature {
  id: FeatureId;
  type: 'chamfer';
  edges: EdgeRef3D[];
  distance: number;
  mode?: 'equal' | 'twoDistance' | 'distanceAngle';
  /** Secondary distance — used only when `mode === 'twoDistance'`. */
  distance2?: number;
  /** Angle in degrees — used only when `mode === 'distanceAngle'`. */
  angle?: number;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** Reference to a plane in the model. Either an existing datum (origin
 * planes or a previously-defined user datum plane) or a flat face of
 * an existing body. The fallbackPlane snapshot lets the geometry
 * resolve even when an upstream regen renumbers face ids — same
 * pattern Extrude's Up-to-Surface end condition uses. */
export type PlaneRef =
  | { kind: 'datum'; datumId: string }
  | { kind: 'face'; faceId: string; fallbackPlane: Plane3 };

/** Reference to a vertex by id in the active model's topology. */
export interface VertexRef {
  vertexId: string;
  /** Cached position at pick time so the feature stays stable when a
   * regen would otherwise renumber the vertex. */
  fallbackPosition: [number, number, number];
}

/** User-defined datum plane feature. Produces one new `DatumElement` of
 * kind 'plane' on each regen, computed from `method` against the
 * current model geometry. Eight construction methods mirroring
 * SolidWorks' "Plane" command — see REQ 657. */
export interface DatumPlaneFeature {
  id: FeatureId;
  type: 'datumPlane';
  /** Discriminated by `kind`; each variant carries the picks +
   * scalars its construction method needs. */
  method:
    | { kind: 'offset'; planeRef: PlaneRef; distance: number; flipped?: boolean }
    | { kind: 'parallelThroughPoint'; planeRef: PlaneRef; vertexRef: VertexRef }
    | { kind: 'angleThroughEdge'; planeRef: PlaneRef; edgeRef: EdgeRef3D; angleDeg: number }
    | { kind: 'threePoints'; vertexRefs: [VertexRef, VertexRef, VertexRef] }
    | { kind: 'midPlane'; planeRefA: PlaneRef; planeRefB: PlaneRef }
    | { kind: 'lineAndPerpFace'; edgeRef: EdgeRef3D; planeRef: PlaneRef }
    | { kind: 'pointAndPerpEdge'; vertexRef: VertexRef; edgeRef: EdgeRef3D }
    | { kind: 'tangentCylinder'; cylinderFaceId: string; planeRef: PlaneRef; flipped?: boolean };
  visible?: boolean;
  name?: string;
  createdAt?: number;
}

/** Resolved axis as 3D geometry — an origin point + unit direction
 * vector in world coordinates. Used both as a sidecar on
 * `DatumElement` (kind 'axis') for user-defined axes, and inside
 * `AxisSnapshot` below for pattern features. */
export interface Axis3 {
  origin: [number, number, number];
  direction: [number, number, number];
}

/** Combine feature — boolean operation between two or more existing
 * bodies in a multi-body part. REQ 662. The result keeps the target
 * body's id so downstream references stay valid; tool bodies are
 * consumed. When the result has multiple disjoint solids (e.g. a
 * Subtract that splits the target), each becomes its own body via
 * the same fan-out the pattern features use. */
export interface CombineFeature {
  id: FeatureId;
  type: 'combine';
  /** 'add' (∪), 'subtract' (target − tools), or 'common' (target ∩ tools). */
  operation: 'add' | 'subtract' | 'common';
  /** Body that survives the operation and keeps its id. */
  targetBodyId: string;
  /** Bodies fed as the second operand. Multiple tools are folded
   * in order: `((target op tool0) op tool1) …`. The tool bodies
   * are CONSUMED — they disappear from the bodies roster. */
  toolBodyIds: string[];
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** User-defined Datum Axis feature. Produces one DatumElement of
 * kind 'axis' on each regen, computed from `method` against the
 * current model geometry. Five construction methods mirroring
 * SolidWorks' "Axis" command — see REQ 660. */
export interface DatumAxisFeature {
  id: FeatureId;
  type: 'datumAxis';
  method:
    | { kind: 'twoPoints'; vertexRefA: VertexRef; vertexRefB: VertexRef }
    | { kind: 'alongEdge'; edgeRef: EdgeRef3D }
    | { kind: 'twoPlanesIntersection'; planeRefA: PlaneRef; planeRefB: PlaneRef }
    | { kind: 'cylindricalFaceAxis'; cylinderFaceId: string; fallbackAxis: Axis3 }
    | { kind: 'pointAndPerpFace'; vertexRef: VertexRef; planeRef: PlaneRef };
  visible?: boolean;
  name?: string;
  createdAt?: number;
}

/** User-defined Datum Point feature. Produces one DatumElement of
 * kind 'point' on each regen, computed from `method` against the
 * current model geometry. Five construction methods — see REQ 661. */
export interface DatumPointFeature {
  id: FeatureId;
  type: 'datumPoint';
  method:
    | { kind: 'onVertex'; vertexRef: VertexRef }
    | { kind: 'centerOfFace'; faceId: string; fallbackPosition: [number, number, number] }
    | { kind: 'centerOfCircularEdge'; edgeRef: EdgeRef3D }
    | { kind: 'centerOfMass'; bodyId: string; fallbackPosition: [number, number, number] }
    | { kind: 'alongEdge'; edgeRef: EdgeRef3D; t: number };
  visible?: boolean;
  name?: string;
  createdAt?: number;
}

/** Reference to an axis in the model. Used by Linear / Circular
 * Pattern for direction / rotation axis picks. REQ 658. */
export type AxisRef =
  | { kind: 'originAxis'; axisId: 'x_axis' | 'y_axis' | 'z_axis' }
  | { kind: 'edge'; edgeRef: EdgeRef3D };

/** Resolved axis snapshot. Origin + unit direction in world coords.
 * Stored on pattern features alongside the `axisRef` so the backend
 * has the geometry without needing to walk datums / topology. The
 * frontend re-snapshots whenever the user edits the feature. */
export interface AxisSnapshot {
  origin: [number, number, number];
  direction: [number, number, number];
}

/** Mirror Feature — reflects the upstream body across a reference
 * plane. Result is the source body fused with its reflection (or just
 * the reflection when `mergeWithSource: false`). The body identity
 * mode is "Mirror Bodies" — multi-body / mirror-individual-features
 * is a later pass. REQ 658. */
export interface MirrorFeatureFeature {
  id: FeatureId;
  type: 'mirror';
  /** Plane to mirror across. Display-only — `planeSnapshot` is the
   * geometry source of truth for regen. */
  planeRef: PlaneRef;
  /** Resolved (origin, normal) at the time of save. Backend reads
   * this directly so it doesn't need to re-walk datums or face
   * geometry. Frontend writes it when the feature is created /
   * edited; if upstream geometry shifts the user must re-pick to
   * refresh. */
  planeSnapshot: Plane3;
  /** Default true — fuse the mirror copy with the source body. */
  mergeWithSource?: boolean;
  /** What the operation repeats. 'bodies' (default, back-compat) reflects the
   * most-recent body. 'features' re-applies each seed feature's add/cut at the
   * mirrored location (SolidWorks-style). REQ 822. */
  seedKind?: PatternSeedKind;
  /** Seed feature ids when `seedKind === 'features'`. */
  seedFeatureIds?: FeatureId[];
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** What a pattern/mirror operation repeats — whole bodies, or the geometric
 * effect of selected upstream features (SolidWorks-style). REQ 822. */
export type PatternSeedKind = 'bodies' | 'features';

/** One direction of a Linear Pattern. */
export interface LinearPatternDirection {
  axisRef: AxisRef;
  axisSnapshot: AxisSnapshot;
  spacing: number;
  count: number;
  flipped?: boolean;
}

/** Linear Pattern — translates copies along one or two directions.
 * Direction 2 produces a 2D grid; `count1 * count2 − 1` copies emit
 * (the source seed occupies the (0,0) cell). REQ 658. */
export interface LinearPatternFeature {
  id: FeatureId;
  type: 'linearPattern';
  direction1: LinearPatternDirection;
  /** Optional second direction. Omit for a 1D pattern. */
  direction2?: LinearPatternDirection;
  mergeWithSource?: boolean;
  /** See MirrorFeatureFeature.seedKind. REQ 822. */
  seedKind?: PatternSeedKind;
  seedFeatureIds?: FeatureId[];
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** Circular Pattern — rotates copies around an axis. REQ 658. */
export interface CircularPatternFeature {
  id: FeatureId;
  type: 'circularPattern';
  axisRef: AxisRef;
  axisSnapshot: AxisSnapshot;
  count: number;
  /** 'equalSpacing': `angleDeg` is the TOTAL sweep distributed evenly
   *  across `count` copies (full revolution = 360°, default).
   *  'specifiedAngle': `angleDeg` is the per-step angle; total sweep =
   *  angleDeg * (count − 1). */
  mode: 'equalSpacing' | 'specifiedAngle';
  angleDeg: number;
  flipped?: boolean;
  mergeWithSource?: boolean;
  /** See MirrorFeatureFeature.seedKind. REQ 822. */
  seedKind?: PatternSeedKind;
  seedFeatureIds?: FeatureId[];
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** One face picked for a Shell feature. `fallbackPlane` snapshot is
 * the centroid + outward normal at pick time — the kernel matches
 * faces geometrically (face IDs aren't stable across regens), and the
 * snapshot survives upstream renumbering. Optional per-face thickness
 * override; if omitted, the feature-level thickness applies. REQ 659. */
export interface ShellFaceRef {
  /** Face id at pick time. Display only — kernel matches by geometry. */
  faceId: string;
  fallbackPlane: { origin: [number, number, number]; normal: [number, number, number] };
  /** Per-face thickness override (mm, magnitude only). When set,
   * replaces the feature-level thickness for this face. Phase 1 kernel
   * ignores this field (single-thickness shell only); reserved for the
   * SetOffsetOnFace path. */
  thickness?: number;
}

/** Shell feature — hollow a solid into a thin-walled body by removing
 * one or more "open" faces and offsetting the rest by a wall thickness.
 * Direction toggle controls inward (default) vs outward offset. The
 * kernel matches picked faces by centroid + normal. REQ 659. */
export interface ShellFeature {
  id: FeatureId;
  type: 'shell';
  faces: ShellFaceRef[];
  /** Wall thickness magnitude in mm. Combined with `direction` to
   * produce the signed offset the kernel consumes (+ outward, − inward). */
  thickness: number;
  /** 'inward' (default, SW default) hollows the body; 'outward' adds
   * a shell of material outside the body. */
  direction: 'inward' | 'outward';
  /** Approximation tolerance for the offset surface (mm). Optional —
   * the backend defaults to 1e-3 mm when missing. */
  tolerance?: number;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** A single hole-center placement: where on a body the hole drops.
 * Captured by clicking a face in the viewer; the click point becomes
 * the hole center and the face's normal becomes the hole axis. The
 * snapshot fields (faceCentroid + faceNormal) survive face renumber
 * the same way DatumPlaneFeature's `fallbackPlane` does — if the
 * faceId is no longer found at regen time, the resolver matches by
 * centroid + normal instead. */
export interface HolePlacement {
  /** Sticky face id from the body's topology at the time of pick. */
  faceId: string;
  /** 3D world position of the user's click on the face. */
  position: [number, number, number];
  /** Face centroid at pick time — fallback when faceId resolution
   * misses after upstream feature renumbers. */
  faceCentroid: [number, number, number];
  /** Outward-pointing face normal at pick time. The hole axis points
   * INTO the body (i.e. −faceNormal) unless `flipped` is set. */
  faceNormal: [number, number, number];
}

/** REQ 663 — Hole Wizard feature. Drops a standardized hole at every
 * placement in the list; each placement was captured by clicking a
 * face in the viewer. All dimensions come from the hardware spec
 * table by default; per-dimension overrides let the user dial in
 * a non-catalog value without losing the spec linkage. */
export interface HoleFeature {
  id: FeatureId;
  type: 'hole';
  /** One entry per hole — drives the per-point loop in the backend. */
  placements: HolePlacement[];
  /** Which hole kind to synthesize. */
  holeType: 'drill' | 'counterbore' | 'countersink' | 'tapped';
  /** Hardware standard — chooses the spec table. */
  standard: import('./holeSpecs').HoleStandard;
  /** Size key into the spec table — must match the standard (e.g.
   * 'M4' / 'I1_4'). */
  size: import('./holeSpecs').HoleSizeKey;
  /** End condition shared by every hole in the feature. */
  endCondition:
    | { kind: 'throughAll' }
    | { kind: 'blind'; depth: number };  // mm, measured along the hole axis
  /** Flip the hole axis to point OUT of the body instead of in. Mirrors
   * the `flipped` flag on Extrude/Cut Extrude. */
  flipped?: boolean;
  /** Manual dimension overrides — when present, take precedence over
   * the spec table value at dispatch time. Only the dimensions
   * relevant to the active hole type are honored (e.g. counterbore
   * overrides are ignored when holeType !== 'counterbore'). */
  drillDiameterOverride?: number;
  counterboreDiameterOverride?: number;
  counterboreDepthOverride?: number;
  countersinkDiameterOverride?: number;
  countersinkAngleOverride?: number;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** REQ 666 — Mirror Body. Reflects every selected body across a
 * reference plane. The mirror plane is picked from a datum plane or
 * a planar face; the snapshot is the geometry source of truth for
 * regen. */
export interface MirrorBodyFeature {
  id: FeatureId;
  type: 'mirrorBody';
  /** Body ids to mirror. Selected via face-click in the sidebar; each
   * face-click resolves to the owning body's id. */
  bodyIds: string[];
  planeRef: PlaneRef;
  /** Resolved (origin, normal) at save time. */
  planeSnapshot: Plane3;
  /** When true (default), each source body stays and a mirrored copy
   * is added; when false, each source body's BREP is replaced in
   * place by its mirror. */
  keepOriginals?: boolean;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** REQ 667 — Move/Copy Body. Applies a rigid-body transform (optional
 * translate + optional rotate) to every selected body. */
export interface MoveCopyBodyFeature {
  id: FeatureId;
  type: 'moveCopyBody';
  bodyIds: string[];
  /** XYZ translation in mm. Default [0,0,0] (no translation). */
  translate?: [number, number, number];
  /** Rotation about an axis. Omitted = no rotation. */
  rotate?: {
    axisRef: AxisRef;
    axisSnapshot: AxisSnapshot;
    angleDeg: number;
  };
  /** When true, source bodies stay and transformed copies are added;
   * when false, source bodies' BREPs are replaced in place. */
  copy?: boolean;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

/** Loft — blend a solid through two or more ordered profile sketches.
 * One profile per section (the first closed region of each sketch). */
export interface LoftFeature {
  id: FeatureId;
  type: 'loft';
  /** Ordered profile sketches to loft between (length >= 2). */
  sketchIds: SketchId[];
  /** SolidWorks-style "Merge result" toggle. Missing == true. */
  merge?: boolean;
  visible?: boolean;
  suppressed?: boolean;
  name?: string;
  createdAt?: number;
}

export type Feature =
  | OriginFeature
  | ExtrudeFeature
  | CutExtrudeFeature
  | RevolveFeature
  | CutRevolveFeature
  | SweepFeature
  | CutSweepFeature
  | FilletFeature
  | ChamferFeature
  | DatumPlaneFeature
  | MirrorFeatureFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | ShellFeature
  | DatumAxisFeature
  | DatumPointFeature
  | CombineFeature
  | HoleFeature
  | LoftFeature
  | MirrorBodyFeature
  | MoveCopyBodyFeature;

/** A named part configuration (SolidWorks/Onshape-style). Overrides global
 * equation-variable values and per-feature suppression; the regen resolves
 * equations with the active configuration's values applied. Stored on the
 * FeatureTree doc so it rides VCS commits via the serializer's
 * featureTreeMeta passthrough — no schema/migration needed. Value keys are
 * equation-entry keys (today: global variable names; the same map accepts
 * target keys like `feature.<id>.distance` if direct-dimension columns are
 * added later). */
export interface CadConfiguration {
  id: string;
  name: string;
  /** Equation-entry overrides: key → literal numeric value. */
  values?: Record<string, number>;
  /** Per-feature suppression overrides: featureId → suppressed. Absent
   * keys inherit the feature's own flag. */
  suppressed?: Record<string, boolean>;
}

export interface FeatureTree {
  features: Feature[];
  nextFeatureSeq: number;
  /** Default display unit for dimensions in this CAD model. Bare numeric
   * input from the user is interpreted in this unit. Per-dimension overrides
   * are stored on the individual constraint. Defaults to 'mm' when unset
   * (legacy models). */
  defaultUnit?: 'mm' | 'um' | 'in';
  /** Named configurations of this part. Absent/empty = single implicit
   * Default (today's behavior). */
  configurations?: CadConfiguration[];
  /** Which configuration regen applies. Absent = base document (Default). */
  activeConfigurationId?: string;
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
  /** Topology edge IDs (matching `ModelTopology.edges[i].id`) that bound
   * this face. Populated by the kernel; missing on legacy payloads.
   * Drives the SolidWorks-style "pick a face → pick all its edges"
   * behaviour in the Fillet / Chamfer sidebar. */
  boundaryEdgeIds?: string[];
}

export interface ModelTopology {
  vertices: Array<{ id: string; position: [number, number, number] }>;
  /** `polyline` is populated for non-straight edges (kernel samples the
   * analytic curve via tangential-deflection). Straight edges omit it
   * since the two endpoints fully describe them. The viewer renders the
   * polyline directly so curved edges look smooth instead of being
   * approximated from per-face mesh tessellation. */
  edges: Array<{
    id: string;
    isStraight: boolean;
    /** True when the edge sits between two faces with continuous tangent
     * planes (G1) — fillet/chamfer blend boundaries and parametric
     * seams. Viewer renders these lighter/dashed so they're visible
     * (matches SolidWorks's "show tangent edges" default) without
     * dominating the silhouette. Defaults to false on pre-2026-05
     * kernel responses. */
    isTangent?: boolean;
    endpoints: [[number, number, number], [number, number, number]];
    polyline?: Array<[number, number, number]>;
  }>;
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
