//! JSON-RPC 2.0 envelope + request/response payload types.
//!
//! Field names exactly match what the Frontend types in
//! `frontend/src/app/cad/lib/profile.ts` and `types.ts` emit. Don't rename
//! them on either side without a coordinated change.

use serde::{Deserialize, Serialize};

// ────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 envelope
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    /// Notifications omit `id`; we return no response in that case.
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(flatten)]
    pub body: RpcBody,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RpcBody {
    Ok { result: serde_json::Value },
    Err { error: RpcError },
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

// JSON-RPC 2.0 spec error codes — stay aligned so a generic client library
// can map them cleanly if we swap one in later.
pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;

// ────────────────────────────────────────────────────────────────────────────
// Geometry primitives shared with the frontend
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Plane3 {
    /// World-space origin of the host plane.
    pub origin: [f64; 3],
    /// In-plane basis vector 1 (unit-length, perpendicular to `normal`).
    #[serde(rename = "xAxis")]
    pub x_axis: [f64; 3],
    /// In-plane basis vector 2 (unit-length, normal × x_axis). Implicit in
    /// the OCCT workplane (derived from normal × x_axis) — kept in the wire
    /// payload so the frontend can transmit a fully-specified frame without
    /// the server needing to recompute and risk sign disagreements.
    #[serde(rename = "yAxis")]
    #[allow(dead_code)]
    pub y_axis: [f64; 3],
    /// Outward unit normal.
    pub normal: [f64; 3],
}

/// Typed profile loop matching `frontend/src/app/cad/lib/profile.ts:ProfileEdge`.
///
/// Edge kinds produce analytic OCCT edges — `Edge::segment` for lines,
/// `Edge::arc` (3-point) for arcs, `Workplane::circle` for the single-circle
/// fast path, and `Edge::bezier` for glyph (text) outlines so each curve is
/// one smooth face rather than N tessellated chords.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProfileEdge {
    Line {
        start: Point2,
        end: Point2,
    },
    Arc {
        center: Point2,
        radius: f64,
        #[serde(rename = "startAngle")]
        start_angle: f64,
        #[serde(rename = "endAngle")]
        end_angle: f64,
        ccw: bool,
        start: Point2,
        end: Point2,
    },
    Circle {
        center: Point2,
        radius: f64,
    },
    /// One Bézier segment. `points` are control points (2 = line, 3 =
    /// quadratic, 4 = cubic); the edge runs points[0] → points[last] and
    /// chains to the next edge. Used for text glyph outlines.
    Bezier {
        points: Vec<Point2>,
    },
}

// ────────────────────────────────────────────────────────────────────────────
// buildExtrude
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BuildExtrudeParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Outer loop of the planar region being extruded.
    pub profile: Vec<ProfileEdge>,
    /// Inner loops cut out of the outer loop (holes). Empty for solid
    /// profiles; one or more entries produces a donut/annular extrude
    /// via Face::subtract → CompoundFace::extrude.
    #[serde(default)]
    pub holes: Vec<Vec<ProfileEdge>>,
    pub plane: Plane3,
    pub distance: f64,
    #[serde(default)]
    pub flipped: bool,
    /// Offset from the sketch plane (along its normal) at which the
    /// profile face is placed before being swept. Missing == 0
    /// (sketchPlane start). Negative values move opposite the normal.
    #[serde(default, rename = "startOffset")]
    pub start_offset: f64,
    /// Optional Direction 2. When present, a second prism is built
    /// starting from the same start plane but growing the OPPOSITE
    /// direction from direction 1, and the two are fused into a single
    /// body. Mirrors SolidWorks' Direction 2.
    #[serde(default, rename = "direction2")]
    pub direction2: Option<BuildExtrudeDirection2>,
    /// Optional "Up To Body" target — a base64 BREP of the body the
    /// extrude should terminate against. When present, `distance` /
    /// `direction2` are ignored: the profile is extruded along the plane
    /// normal (in the `flipped` direction, from `start_offset`) far enough
    /// to reach the body, then the body is subtracted and the start-side
    /// piece kept, so the end face conforms to the body's real surface.
    #[serde(default, rename = "untilBrep")]
    pub until_brep: Option<String>,
    /// Optional "Up To Next" targets — base64 BREPs of EVERY upstream body.
    /// Same semantics as `until_brep` but all targets are subtracted, so the
    /// kept start-side piece caps at whichever body surface the profile reaches
    /// FIRST. Combined with `until_brep` (both are subtracted if present).
    #[serde(default, rename = "untilBreps")]
    pub until_breps: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BuildExtrudeDirection2 {
    pub distance: f64,
    /// 'blind' or 'throughAll' for now — others fall back to blind in
    /// the kernel until end-condition resolution lands here too.
    #[serde(default = "default_blind_kind")]
    pub kind: String,
}

fn default_blind_kind() -> String { "blind".to_string() }

fn default_feature_id() -> String {
    "f_anon".to_string()
}

#[derive(Debug, Serialize)]
pub struct BuildExtrudeResult {
    /// BREP serialization (text form for Phase 0; binary `BinTools` payload
    /// in Phase 1) base64-encoded for JSON transport.
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
}

#[derive(Debug, Serialize)]
pub struct FaceMesh {
    /// The persistent name (see `naming.rs`) doubles as the face identifier.
    #[serde(rename = "faceId")]
    pub face_id: String,
    #[serde(rename = "persistentName")]
    pub persistent_name: String,
    #[serde(rename = "isFlat")]
    pub is_flat: bool,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
    /// Topology edge IDs (matching `Topology.edges[i].id`) that bound
    /// this face. Excludes dropped seam edges. Empty until populated by
    /// `tessellate_faces_generic_with_topology` (or the extrude variant)
    /// when called with a topology argument; otherwise empty.
    #[serde(rename = "boundaryEdgeIds", default, skip_serializing_if = "Vec::is_empty")]
    pub boundary_edge_ids: Vec<String>,
    /// Analytic surface classification for planar/cylindrical faces (REQ 749),
    /// consumed by the assembly mate solver. None for other surface kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<FaceSurface>,
}

/// Analytic classification of a face's underlying surface, in the model frame.
/// Planes carry an origin + outward `normal`; cylinders carry an axis origin,
/// `axis` direction, and `radius`. The mate solver consumes these (not the mesh).
#[derive(Debug, Clone, Serialize)]
pub struct FaceSurface {
    /// "plane" | "cylinder".
    pub kind: String,
    pub origin: [f64; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normal: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
}

#[derive(Debug, Default, Serialize)]
pub struct Topology {
    pub vertices: Vec<TopologyVertex>,
    pub edges: Vec<TopologyEdge>,
}

#[derive(Debug, Serialize)]
pub struct TopologyVertex {
    pub id: String,
    pub position: [f64; 3],
}

#[derive(Debug, Serialize)]
pub struct TopologyEdge {
    pub id: String,
    #[serde(rename = "isStraight")]
    pub is_straight: bool,
    /// True when the two faces meeting at this edge share a tangent
    /// plane (G1-continuous). These are the boundary edges of fillet /
    /// chamfer blends and parametric seams. The viewer typically draws
    /// them lighter / dashed so they're visible without dominating the
    /// silhouette. Frontend defaults to `false` when missing
    /// (backwards-compat with pre-2026-05 kernels). */
    #[serde(rename = "isTangent", default, skip_serializing_if = "is_false")]
    pub is_tangent: bool,
    pub endpoints: [[f64; 3]; 2],
    /// Sampled points along the actual analytic curve (start → end,
    /// inclusive). Populated for non-straight edges so the viewer can
    /// render the smooth curve directly instead of chord-approximating
    /// it from per-face mesh tessellation. None for straight edges (the
    /// two endpoints fully describe them).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub polyline: Option<Vec<[f64; 3]>>,
}

fn is_false(b: &bool) -> bool { !b }

// ────────────────────────────────────────────────────────────────────────────
// buildBoolean
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildBooleanOp {
    /// A ∪ B — union. Backend uses this to compose successive additive
    /// extrudes into one cumulative body.
    Fuse,
    /// A − B — subtract. Backend uses this for CutExtrude (the prism is B).
    Cut,
    /// A ∩ B — intersection. Reserved for Up to Body (clip the extrude
    /// prism against the target body's half-space).
    Common,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuildBooleanParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    pub op: BuildBooleanOp,
    /// First operand BREP (the cumulative body for fuse/cut).
    #[serde(rename = "aBrep")]
    pub a_brep: String,
    /// Second operand BREP (the new prism for fuse/cut).
    #[serde(rename = "bBrep")]
    pub b_brep: String,
}

#[derive(Debug, Serialize)]
pub struct BuildBooleanResult {
    /// Whole-shape BRep — the compound result of the boolean op. This is
    /// what the backend feeds into the NEXT compose op (so the cumulative
    /// pipeline stays intact even when the body has split into multiple
    /// disjoint solids).
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    /// Whole-shape face tessellation. Equivalent to the union of every
    /// `solids[i].faces`, kept for backward compat with paths that don't
    /// care about per-solid tracking.
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
    /// Per-solid breakdown. A boolean cut can split a single body into
    /// two or more disjoint pieces (think "cut a donut in half" or
    /// "slice a part through the middle"); each gets its own entry here
    /// so the backend can track them SolidWorks-style as independent
    /// bodies. Always has ≥ 1 entry on success.
    #[serde(default)]
    pub solids: Vec<SolidPart>,
}

/// One disjoint solid extracted from a multi-solid boolean result. Used
/// by the backend's body-tracking logic to detect when a cut has split
/// a body and assign persistent body ids to each piece.
#[derive(Debug, Serialize)]
pub struct SolidPart {
    /// BRep payload for THIS solid only (not the surrounding compound).
    /// The backend caches each split body's BRep separately so subsequent
    /// per-body operations can act on a single piece.
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    /// World-space centroid (center of mass). Used by the backend to
    /// match this solid to its "ancestor" body across regens — the
    /// largest piece keeps the original body id; closest-centroid wins
    /// when volumes tie.
    pub centroid: [f64; 3],
    /// Solid volume in mm³. The body with the largest volume keeps the
    /// original body id; smaller pieces get derived ids like
    /// `${feature.id}#split${N}`.
    pub volume: f64,
    /// Per-solid face tessellation, namespaced by solid index in the
    /// emitting feature's id so face ids stay unique across bodies.
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
}

// ────────────────────────────────────────────────────────────────────────────
// buildEdgeBlend (fillet / chamfer)
// ────────────────────────────────────────────────────────────────────────────

/// Kind of edge blend operation. `Fillet` rounds the picked edges with the
/// given radius; `Chamfer` cuts a bevel using one of three modes
/// (see `ChamferMode`).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeBlendKind {
    Fillet,
    Chamfer,
}

/// SolidWorks-style chamfer mode.
///   - `Equal` — single distance applied symmetrically (existing
///     behaviour; matches OCCT's `MakeChamfer::Add(d, edge)`).
///   - `TwoDistance` — distance + distance2, asymmetric. The first
///     adjacent face the kernel finds is the reference face for the
///     primary distance.
///   - `DistanceAngle` — distance + angle (in degrees) measured FROM
///     the reference face.
#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ChamferMode {
    #[default]
    Equal,
    TwoDistance,
    DistanceAngle,
}

/// One target edge for a blend, identified by its two world-space endpoints.
/// The kernel iterates the input shape's edges and matches the one whose
/// endpoint pair (in either order) is closest — robust to OCCT renumbering
/// across booleans, since geometry is the stable identity.
///
/// `value` is an optional per-edge override (radius for fillet, distance
/// for chamfer). When omitted, the feature-level `value` applies.
#[derive(Debug, Clone, Deserialize)]
pub struct EdgeRef {
    pub start: [f64; 3],
    pub end: [f64; 3],
    #[serde(default)]
    pub value: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct BuildEdgeBlendParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Input body BREP — the shape we're filleting/chamfering.
    #[serde(rename = "aBrep")]
    pub a_brep: String,
    pub kind: EdgeBlendKind,
    /// Common parameter (radius for fillet, leg distance for chamfer).
    pub value: f64,
    /// Edges to blend, identified by world-space endpoint coordinates.
    pub edges: Vec<EdgeRef>,
    /// Chamfer mode. Ignored when `kind` is `Fillet`. Missing field
    /// defaults to `Equal` so legacy payloads keep working.
    #[serde(default, rename = "chamferMode")]
    pub chamfer_mode: ChamferMode,
    /// Secondary distance for `ChamferMode::TwoDistance`.
    #[serde(default, rename = "distance2")]
    pub distance2: Option<f64>,
    /// Angle in DEGREES for `ChamferMode::DistanceAngle`. Converted to
    /// radians before being handed to OCCT.
    #[serde(default)]
    pub angle: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct BuildEdgeBlendResult {
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
    /// Per-solid breakdown — same convention as buildBoolean. Always
    /// ≥ 1 entry on success; a successful fillet/chamfer of a single
    /// body yields one solid.
    #[serde(default)]
    pub solids: Vec<SolidPart>,
}

// ────────────────────────────────────────────────────────────────────────────
// buildPattern (Mirror Feature, Linear Pattern, Circular Pattern)
// ────────────────────────────────────────────────────────────────────────────

/// One transform in a pattern's transform list. Frontend computes the
/// list per pattern kind: mirror → 1 entry (kind=mirror); linear → N
/// entries (kind=translate, one per step beyond the source); circular
/// → N entries (kind=rotate, one per step). REQ 658.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PatternTransform {
    Translate {
        dx: f64,
        dy: f64,
        dz: f64,
    },
    Rotate {
        origin: [f64; 3],
        direction: [f64; 3],
        #[serde(rename = "angleRad")]
        angle_rad: f64,
    },
    Mirror {
        origin: [f64; 3],
        normal: [f64; 3],
    },
}

#[derive(Debug, Deserialize)]
pub struct BuildPatternParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Source body BREP — the shape getting replicated.
    #[serde(rename = "aBrep")]
    pub a_brep: String,
    /// One transform per copy. Order doesn't matter for the geometric
    /// result (fuse is commutative) but the kernel applies them in
    /// list order anyway.
    pub transforms: Vec<PatternTransform>,
    /// When true (default), the source body is fused with the copies
    /// into one body. When false, only the copies are fused — the
    /// source stays as its own upstream body. Matches SolidWorks's
    /// "Geometry pattern" / "Merge result" options.
    #[serde(rename = "mergeWithSource", default = "default_true")]
    pub merge_with_source: bool,
}

fn default_true() -> bool { true }

/// `buildFeaturePattern` — repeat a seed feature's geometry delta (computed from
/// the body state before/after the seed) at N transformed instances. Returns the
/// same shape as `buildPattern` so the backend composer is indifferent.
#[derive(Debug, Deserialize)]
pub struct BuildFeaturePatternParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Body BREP just BEFORE the seed feature. Absent/empty for a body-seeding
    /// feature (nothing was removed).
    #[serde(rename = "beforeBrep", default)]
    pub before_brep: Option<String>,
    /// Body BREP just AFTER the seed feature.
    #[serde(rename = "afterBrep")]
    pub after_brep: String,
    /// The current body to apply the patterned delta into.
    #[serde(rename = "bodyBrep")]
    pub body_brep: String,
    /// One transform per copy (the N−1 instances; the source is already in body).
    pub transforms: Vec<PatternTransform>,
}

/// `buildToolPattern` — true feature pattern for a tool-based seed: transform
/// the seed's tool solid at each instance and fuse/cut it into the body.
#[derive(Debug, Deserialize)]
pub struct BuildToolPatternParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// The current body to apply the patterned tool into.
    #[serde(rename = "bodyBrep")]
    pub body_brep: String,
    /// The seed feature's tool solid (the prism/revolve/sweep/loft it built).
    #[serde(rename = "toolBrep")]
    pub tool_brep: String,
    /// One transform per copy (the N−1 instances; the source is already in body).
    pub transforms: Vec<PatternTransform>,
    /// true = additive seed (fuse the tool); false = cut seed (subtract it).
    #[serde(default)]
    pub fuse: bool,
}

#[derive(Debug, Serialize)]
pub struct BuildPatternResult {
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
    #[serde(default)]
    pub solids: Vec<SolidPart>,
}

// ────────────────────────────────────────────────────────────────────────────
// buildShell (Shell — hollow a solid by removing faces + wall thickness)
// ────────────────────────────────────────────────────────────────────────────

/// One face to remove from the source body during the shell operation.
/// Matched geometrically by `centroid` + `normal` so the kernel doesn't
/// depend on stable face IDs across regens. REQ 659.
#[derive(Debug, Clone, Deserialize)]
pub struct ShellFaceRef {
    pub centroid: [f64; 3],
    pub normal: [f64; 3],
}

#[derive(Debug, Deserialize)]
pub struct BuildShellParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Source body BREP — the solid to hollow.
    #[serde(rename = "aBrep")]
    pub a_brep: String,
    /// Faces to remove (the open faces of the resulting thin-walled
    /// body). At least one must be supplied.
    pub faces: Vec<ShellFaceRef>,
    /// Wall thickness in mm. Positive = outward offset (adds material
    /// outside the body); negative = inward offset (removes material
    /// from inside). Convention matches OCCT's BRepOffsetAPI_MakeThickSolid.
    pub thickness: f64,
    /// Approximation tolerance for the offset surface (mm). 1e-3 mm is
    /// a sensible default for typical body sizes.
    #[serde(default = "default_shell_tolerance")]
    pub tolerance: f64,
}

fn default_shell_tolerance() -> f64 { 1.0e-3 }

#[derive(Debug, Serialize)]
pub struct BuildShellResult {
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
    #[serde(default)]
    pub solids: Vec<SolidPart>,
}

// ────────────────────────────────────────────────────────────────────────────
// buildRevolve
// ────────────────────────────────────────────────────────────────────────────

/// Inputs for a revolve operation. The sketch profile is built on
/// `plane` (same machinery as buildExtrude), then revolved about the
/// world-space axis defined by `axis_origin` + `axis_dir` through
/// `angle_deg`. Angle of 360 produces a full body of revolution.
#[derive(Debug, Deserialize)]
pub struct BuildRevolveParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    pub profile: Vec<ProfileEdge>,
    #[serde(default)]
    pub holes: Vec<Vec<ProfileEdge>>,
    pub plane: Plane3,
    #[serde(rename = "axisOrigin")]
    pub axis_origin: [f64; 3],
    #[serde(rename = "axisDir")]
    pub axis_dir: [f64; 3],
    /// Sweep angle in degrees. 360 → full revolve. Sign of the angle
    /// flips the rotational sense (CCW vs CW around axis_dir).
    #[serde(rename = "angleDeg")]
    pub angle_deg: f64,
}

#[derive(Debug, Serialize)]
pub struct BuildRevolveResult {
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
}

// ────────────────────────────────────────────────────────────────────────────
// buildSweep
// ────────────────────────────────────────────────────────────────────────────

/// Typed path edge for sweeps. Coordinates are WORLD-space — the backend
/// has already projected the sketched 2D segments through the path
/// sketch's plane. Lines/arcs walk in chain order; arcs use the 3-point
/// (start, mid, end) form that OCCT's GC_MakeArcOfCircle consumes
/// directly. A single circle path is a one-edge closed curve.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PathEdge {
    Line {
        start: [f64; 3],
        end: [f64; 3],
    },
    Arc {
        start: [f64; 3],
        /// A point on the arc between `start` and `end` — the unique
        /// circular arc through these three points is what OCCT builds.
        mid: [f64; 3],
        end: [f64; 3],
    },
    Circle {
        center: [f64; 3],
        radius: f64,
        /// Plane normal (the path sketch's normal) — defines the circle's
        /// orientation in 3D. The reference direction (zero angle) is
        /// implementation-defined; the swept result is rotationally
        /// symmetric so it doesn't matter.
        normal: [f64; 3],
    },
}

#[derive(Debug, Deserialize)]
pub struct BuildSweepParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Outer loop of the closed profile region being swept.
    pub profile: Vec<ProfileEdge>,
    /// Inner loops (holes) of the profile region. Each becomes a hole
    /// running the length of the swept solid. Empty for solid profiles.
    #[serde(default)]
    pub holes: Vec<Vec<ProfileEdge>>,
    /// Workplane the profile is drawn on. The profile face is built here
    /// and then transported along the path by OCCT's pipe builder.
    #[serde(rename = "profilePlane")]
    pub profile_plane: Plane3,
    /// Path the profile is swept along, in chain order. At least one
    /// edge is required; the kernel rejects degenerate paths
    /// (zero-length lines, coincident arc endpoints, etc.).
    #[serde(rename = "pathEdges")]
    pub path_edges: Vec<PathEdge>,
}

#[derive(Debug, Serialize)]
pub struct BuildSweepResult {
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
}

// ────────────────────────────────────────────────────────────────────────────
// bodyVolume — exact mass properties (OCCT GProp) for a single body BRep
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BodyVolumeParams {
    /// Base64-encoded BREP of the body to measure.
    #[serde(rename = "aBrep")]
    pub a_brep: String,
}

#[derive(Debug, Serialize)]
pub struct BodyVolumeResult {
    /// Exact solid volume in mm³ (OCCT volume integral over the analytic
    /// faces — NOT a mesh approximation).
    pub volume: f64,
    /// Center of mass (world space).
    pub centroid: [f64; 3],
}

// ────────────────────────────────────────────────────────────────────────────
// exportStep — combine body BReps into a STEP file
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExportStepParams {
    /// Base64-encoded BREP for each body to include in the STEP file.
    #[serde(default)]
    pub breps: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportStepResult {
    /// STEP file contents as text.
    pub step: String,
}

// ────────────────────────────────────────────────────────────────────────────
// exportStl — combine body BReps into a (binary) STL file
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExportStlParams {
    /// Base64-encoded BREP for each body to include in the STL file.
    #[serde(default)]
    pub breps: Vec<String>,
    /// Mesh chord tolerance (mm). Defaults to 0.01.
    #[serde(default = "default_stl_tolerance")]
    pub tolerance: f64,
}
fn default_stl_tolerance() -> f64 { 0.01 }

#[derive(Debug, Serialize)]
pub struct ExportStlResult {
    /// Binary STL file contents, base64-encoded.
    #[serde(rename = "stlBase64")]
    pub stl_base64: String,
}

// ────────────────────────────────────────────────────────────────────────────
// buildLoft — solid lofted through ordered profile sections
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoftSection {
    /// Outer loop of this section's profile (holes not yet supported in loft).
    pub profile: Vec<ProfileEdge>,
    /// The sketch plane this section's profile lives on.
    pub plane: Plane3,
}

#[derive(Debug, Deserialize)]
pub struct BuildLoftParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    /// Two or more ordered profile sections to loft between.
    pub sections: Vec<LoftSection>,
}
