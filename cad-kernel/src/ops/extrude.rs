//! `buildExtrude` — turn a typed profile + host plane into a tessellated
//! extruded solid via OCCT (through the `opencascade` crate).
//!
//! Handles `line`, `arc`, and `circle` profile edges. Arcs use
//! `Sketch::three_point_arc` with the midpoint computed from the protocol's
//! (centre, radius, startAngle, endAngle, ccw) so the resulting face has a
//! true analytic arc edge rather than a chord approximation.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use glam::{dvec3, DVec3};
use opencascade::{
    primitives::{CompoundFace, Face, Shape, Solid},
    workplane::Workplane,
};
use tracing::{info, warn};

use crate::naming::PersistentName;
use crate::protocol::{
    BuildExtrudeParams, BuildExtrudeResult, FaceMesh, Plane3, ProfileEdge,
    Topology, TopologyEdge, TopologyVertex,
};

/// Chord tolerance for triangulation, in model units. Match the frontend's
/// tessellator (`DEFAULT_CHORD_TOLERANCE = 0.05`) so the server-side mesh
/// matches what the sketch-editor preview shows.
const DEFAULT_CHORD_TOLERANCE: f64 = 0.05;

pub fn build(params: &BuildExtrudeParams) -> Result<BuildExtrudeResult> {
    let signed_distance = if params.flipped { -params.distance } else { params.distance };

    let workplane = build_workplane(&params.plane);

    // Extrude along the host plane's normal × signed distance.
    let extrude_dir = dvec3(
        params.plane.normal[0] * signed_distance,
        params.plane.normal[1] * signed_distance,
        params.plane.normal[2] * signed_distance,
    );

    // Branch on holes. The fast path (no holes) keeps the existing
    // Face::extrude pipeline so non-annular extrudes stay byte-identical
    // to schema-version-2 output for the same input. The donut/annular
    // path builds outer + hole faces and subtracts them into a
    // CompoundFace, then extrudes that.
    let shape: Shape = if params.holes.is_empty() {
        let face = build_profile_face(&workplane, &params.profile)?;
        let solid: Solid = face.extrude(extrude_dir);
        solid.into()
    } else {
        let compound = build_compound_face_with_holes(&workplane, &params.profile, &params.holes)?;
        compound.extrude(extrude_dir)
    };

    let plane_origin = dvec3(params.plane.origin[0], params.plane.origin[1], params.plane.origin[2]);
    let plane_normal = dvec3(params.plane.normal[0], params.plane.normal[1], params.plane.normal[2]);

    let faces_out = tessellate_and_name(&shape, plane_origin, plane_normal, signed_distance, &params.feature_id)?;
    let topology = extract_topology(&shape);
    let brep_bytes = serialize_brep(&shape);

    Ok(BuildExtrudeResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces: faces_out,
        topology,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Workplane + profile construction
// ────────────────────────────────────────────────────────────────────────────

fn build_workplane(plane: &Plane3) -> Workplane {
    // Workplane::new(x_dir, normal_dir) — y_dir is implied as normal × x_dir
    // (right-handed). `set_translation` takes a world-space origin verbatim;
    // `translated()` (immutable variant) re-projects the offset through the
    // workplane's rotation first via `to_world_pos`, which is the wrong
    // semantics when the protocol gives us a world-space origin directly.
    let x = dvec3(plane.x_axis[0], plane.x_axis[1], plane.x_axis[2]);
    let n = dvec3(plane.normal[0], plane.normal[1], plane.normal[2]);
    let origin = dvec3(plane.origin[0], plane.origin[1], plane.origin[2]);
    let mut wp = Workplane::new(x, n);
    wp.set_translation(origin);
    wp
}

fn build_profile_face(workplane: &Workplane, profile: &[ProfileEdge]) -> Result<Face> {
    if profile.is_empty() {
        return Err(anyhow!("profile is empty"));
    }
    // Fast path — a single `circle` edge IS the loop (matches REQ 612 on the
    // frontend). The Wire returned by Workplane::circle is closed by
    // construction.
    if profile.len() == 1 {
        if let ProfileEdge::Circle { center, radius } = &profile[0] {
            let wire = workplane.circle(center.x, center.y, *radius);
            return Ok(Face::from_wire(&wire));
        }
    }

    // Reject mixed circles early — a circle must be the sole edge.
    for edge in profile {
        if let ProfileEdge::Circle { .. } = edge {
            return Err(anyhow!(
                "'circle' edge mixed into a polygon profile is invalid; circles must be the sole edge"
            ));
        }
    }

    // Chord polygon — vertex per edge's start. Used for the orientation/area
    // check and the validate_polygon defensive guards. With arcs in the loop
    // this is an approximation, but a fine one for determining the loop's
    // winding (the arcs deviate from the chord by O(radius - radius·cos(half-sweep)),
    // never enough to flip the sign of the signed area).
    let mut polygon: Vec<(f64, f64)> = profile.iter().map(|e| match e {
        ProfileEdge::Line { start, .. } => (start.x, start.y),
        ProfileEdge::Arc  { start, .. } => (start.x, start.y),
        ProfileEdge::Circle { .. } => unreachable!("rejected above"),
    }).collect();
    if polygon.len() < 3 {
        return Err(anyhow!(
            "profile must have at least 3 edges to form a closed polygon, got {}",
            polygon.len()
        ));
    }
    polygon = dedup_consecutive(polygon);
    if polygon.len() < 3 {
        return Err(anyhow!(
            "profile collapses to fewer than 3 distinct vertices after merging \
             coincident points — the sketch likely has overlapping geometry",
        ));
    }
    validate_polygon(&polygon)?;

    // OCCT wants a counter-clockwise wire for `face.extrude` to produce an
    // outward-pointing solid. The frontend's walker doesn't guarantee
    // orientation, so we reverse here if needed. For arcs the reversal
    // ALSO swaps start↔end and flips ccw so the arc is traversed in the
    // opposite rotational sense.
    let reverse = signed_polygon_area(&polygon) < 0.0;
    let edges: Vec<&ProfileEdge> = if reverse {
        profile.iter().rev().collect()
    } else {
        profile.iter().collect()
    };

    // Start point: first edge's start (or end if reversed).
    let first = edges[0];
    let (sx, sy) = traversal_start(first, reverse);
    info!("profile walk start ({:.4}, {:.4}), reverse={}, edges={}",
          sx, sy, reverse, edges.len());
    let mut sketch = workplane.sketch().move_to(sx, sy);
    // Track the running cursor in Rust so we can skip degenerate edges
    // (zero-length lines, arcs with start ≈ end) before they reach OCCT.
    // OCCT throws StdFail_NotDone from MakeEdge / MakeArcOfCircle for these
    // and the C++ exception escapes Rust as a SIGABRT, killing the kernel.
    // Upstream walkers can produce such edges when the sketch contains a
    // degenerate entity (e.g. a Line with startId == endId left from a
    // half-completed edit), and a defensive skip here is cheaper than
    // hardening every upstream walker.
    let mut cursor = (sx, sy);
    const MIN_EDGE_LEN_SQ: f64 = 1.0e-10;

    for (i, edge) in edges.iter().enumerate() {
        match **edge {
            ProfileEdge::Line { start, end } => {
                let (ex, ey) = if reverse { (start.x, start.y) } else { (end.x, end.y) };
                let dx = ex - cursor.0;
                let dy = ey - cursor.1;
                if dx * dx + dy * dy < MIN_EDGE_LEN_SQ {
                    warn!("  edge {}: skipping zero-length line at ({:.4}, {:.4})", i, ex, ey);
                    continue;
                }
                info!("  edge {}: line_to ({:.4}, {:.4})", i, ex, ey);
                sketch = sketch.line_to(ex, ey);
                cursor = (ex, ey);
            }
            ProfileEdge::Arc { center, radius, start_angle, end_angle, ccw, start, end } => {
                // After reversal, swap start↔end and flip ccw. The arc's
                // rotational sense is preserved by inverting both, which
                // keeps the geometry identical but traverses it the other
                // way around.
                let (sa, ea, sweep_ccw, sx_a, sy_a, ex, ey) = if reverse {
                    (end_angle, start_angle, !ccw, end.x, end.y, start.x, start.y)
                } else {
                    (start_angle, end_angle, ccw, start.x, start.y, end.x, end.y)
                };
                let dx = ex - cursor.0;
                let dy = ey - cursor.1;
                if dx * dx + dy * dy < MIN_EDGE_LEN_SQ {
                    warn!("  edge {}: skipping zero-length arc (start ≈ end)", i);
                    continue;
                }
                // Sweep angle in the traversal's rotational sense, normalised
                // to (0, 2π] for CCW or [-2π, 0) for CW.
                let mut sweep = ea - sa;
                if sweep_ccw {
                    while sweep <= 0.0 { sweep += std::f64::consts::TAU; }
                } else {
                    while sweep >= 0.0 { sweep -= std::f64::consts::TAU; }
                }
                let mid_angle = sa + sweep / 2.0;
                let mid_x = center.x + radius * mid_angle.cos();
                let mid_y = center.y + radius * mid_angle.sin();
                info!(
                    "  edge {}: three_point_arc start=({:.4}, {:.4}) mid=({:.4}, {:.4}) end=({:.4}, {:.4}) \
                     center=({:.4}, {:.4}) r={:.4} sa={:.4} ea={:.4} ccw={} sweep={:.4}",
                    i, sx_a, sy_a, mid_x, mid_y, ex, ey,
                    center.x, center.y, radius, sa, ea, sweep_ccw, sweep,
                );
                sketch = sketch.three_point_arc((mid_x, mid_y), (ex, ey));
                cursor = (ex, ey);
            }
            ProfileEdge::Circle { .. } => unreachable!("rejected above"),
        }
    }

    // Each edge in the walk ends at the next edge's start, and the final
    // edge ends at the loop's start point — so cursor == first_point and
    // `wire()` collects the closed chain. `close()` would add a tautological
    // zero-length segment that OCCT rejects.
    let wire = sketch.wire();
    Ok(Face::from_wire(&wire))
}

/// Build a planar face with holes (CompoundFace) by subtracting each
/// hole's face from the outer face one at a time. Each iteration takes
/// the running CompoundFace ⊖ the next hole (promoted Face → CompoundFace
/// via `From<Face>`). Used for donut-style regions from
/// `extractRegions` where the outer loop has one or more inner loops.
fn build_compound_face_with_holes(
    workplane: &Workplane,
    outer: &[ProfileEdge],
    holes: &[Vec<ProfileEdge>],
) -> Result<CompoundFace> {
    let outer_face = build_profile_face(workplane, outer)
        .context("building outer face of region")?;
    let mut acc: CompoundFace = outer_face.into();
    for (i, hole_edges) in holes.iter().enumerate() {
        let hole_face = build_profile_face(workplane, hole_edges)
            .with_context(|| format!("building hole face {}", i))?;
        let hole_compound: CompoundFace = hole_face.into();
        acc = acc.subtract(&hole_compound);
    }
    Ok(acc)
}

/// Start point for the loop walk, accounting for the reversal flag — the
/// "start" of the first edge in the traversal is its `start` field normally,
/// or its `end` field when the profile is being walked in reverse.
fn traversal_start(edge: &ProfileEdge, reverse: bool) -> (f64, f64) {
    match edge {
        ProfileEdge::Line { start, end } |
        ProfileEdge::Arc  { start, end, .. } => {
            if reverse { (end.x, end.y) } else { (start.x, start.y) }
        }
        ProfileEdge::Circle { .. } => unreachable!(),
    }
}

/// Reject profiles OCCT can't build a wire from. Each branch maps to a
/// known way `BRepBuilderAPI_MakeWire` throws `StdFail_NotDone`:
///   - Zero-length edges (consecutive coincident vertices) → MakeEdge fails.
///   - Three consecutive collinear vertices → degenerate Y-junction; some
///     OCCT versions throw, others produce a malformed wire.
///   - Below-threshold total area → degenerate face; extrude throws.
const MIN_VERTEX_DIST_SQ: f64 = 1.0e-8;   // ~1e-4 units between points
const MIN_POLY_AREA: f64 = 1.0e-6;        // 1e-3 × 1e-3 — way below any
                                          // realistic CAD sketch
const COLLINEAR_TOL: f64 = 1.0e-9;        // |cross product| threshold

fn validate_polygon(points: &[(f64, f64)]) -> Result<()> {
    let n = points.len();
    for i in 0..n {
        let (ax, ay) = points[i];
        let (bx, by) = points[(i + 1) % n];
        let dx = bx - ax;
        let dy = by - ay;
        if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ {
            return Err(anyhow!(
                "profile has a zero-length edge between vertices {} and {} — \
                 consecutive points coincide (likely a near-degenerate polygon)",
                i, (i + 1) % n,
            ));
        }
    }
    // Collinear-triple check is a soft warning: many valid CAD profiles have
    // colinear points where two segments meet without a corner (e.g. a slot's
    // straight side adjoining a cap). We only flag the case where THREE
    // consecutive vertices are exactly collinear AND the middle one is
    // between the two others — that's a degenerate corner.
    for i in 0..n {
        let a = points[i];
        let b = points[(i + 1) % n];
        let c = points[(i + 2) % n];
        let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        if cross.abs() > COLLINEAR_TOL { continue; }
        // Same-line; check if b is between a and c.
        let dot = (b.0 - a.0) * (c.0 - a.0) + (b.1 - a.1) * (c.1 - a.1);
        let ac_len_sq = (c.0 - a.0).powi(2) + (c.1 - a.1).powi(2);
        if dot > 0.0 && dot < ac_len_sq {
            return Err(anyhow!(
                "profile has a degenerate corner at vertex {} — three \
                 consecutive points are collinear with the middle one on the \
                 segment", (i + 1) % n,
            ));
        }
    }
    let area = signed_polygon_area(points).abs();
    if area < MIN_POLY_AREA {
        return Err(anyhow!(
            "profile encloses near-zero area ({}); pick distinct vertices", area,
        ));
    }
    Ok(())
}

/// Drop any vertex that sits within `MIN_VERTEX_DIST_SQ` of its predecessor
/// (and the wrap-around case where the last vertex sits on the first). This
/// makes the kernel robust to upstream walkers that emit duplicate vertices.
fn dedup_consecutive(points: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    if points.is_empty() { return points; }
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for p in points {
        if let Some(&last) = out.last() {
            let dx = p.0 - last.0;
            let dy = p.1 - last.1;
            if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ { continue; }
        }
        out.push(p);
    }
    // Wrap-around: if the last point coincides with the first (the would-be
    // closing edge is zero-length), drop the last.
    while out.len() > 1 {
        let first = out[0];
        let last = *out.last().unwrap();
        let dx = last.0 - first.0;
        let dy = last.1 - first.1;
        if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ { out.pop(); } else { break; }
    }
    out
}

/// Shoelace formula. Positive == CCW, negative == CW. Zero for degenerate.
fn signed_polygon_area(points: &[(f64, f64)]) -> f64 {
    let n = points.len();
    let mut sum = 0.0_f64;
    for i in 0..n {
        let (x1, y1) = points[i];
        let (x2, y2) = points[(i + 1) % n];
        sum += x1 * y2 - x2 * y1;
    }
    sum / 2.0
}

// ────────────────────────────────────────────────────────────────────────────
// Per-face tessellation + persistent naming
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
enum FaceKind { CapBottom, CapTop, Side }

fn tessellate_and_name(
    shape: &Shape,
    plane_origin: DVec3,
    plane_normal: DVec3,
    signed_distance: f64,
    feature_id: &str,
) -> Result<Vec<FaceMesh>> {
    // Pre-pass: classify each OCCT face by where its centroid sits along the
    // normal axis. Cap-bottom = axial ≈ 0; cap-top = axial ≈ signed_distance;
    // everything else = side.
    let tol = (signed_distance.abs() * 1e-3).max(1e-6);

    let mut classified: Vec<(FaceKind, Face, f64, f64)> = Vec::new();
    for face in shape.faces() {
        let centroid = face.center_of_mass();
        let offset = centroid - plane_origin;
        let axial = offset.dot(plane_normal);
        let kind = if (axial - 0.0).abs() <= tol {
            FaceKind::CapBottom
        } else if (axial - signed_distance).abs() <= tol {
            FaceKind::CapTop
        } else {
            FaceKind::Side
        };
        // Angular sort key for side faces — keeps side `0` consistent across
        // regens (otherwise face enumeration order would be OCCT-internal
        // and could rearrange under harmless edits).
        let in_plane = offset - plane_normal * axial;
        let angle = in_plane.z.atan2(in_plane.x);
        classified.push((kind, face, axial, angle));
    }
    classified.sort_by(|a, b| {
        let order_a = match a.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        let order_b = match b.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        order_a.cmp(&order_b).then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut side_index = 0_u32;
    let mut out = Vec::with_capacity(classified.len());
    for (kind, face, _axial, _angle) in classified {
        let face_shape: Shape = (&face).into();
        let mesh = face_shape
            .mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE)
            .context("BRepMesh failed on a face")?;
        let (positions, normals, indices) = flatten_mesh(&mesh);
        let (persistent, is_flat) = match kind {
            FaceKind::CapBottom => (PersistentName::cap_bottom(feature_id), true),
            FaceKind::CapTop => (PersistentName::cap_top(feature_id), true),
            FaceKind::Side => {
                let n = PersistentName::side(feature_id, side_index);
                side_index += 1;
                (n, looks_flat(&normals))
            }
        };
        let id = persistent.encode();
        out.push(FaceMesh {
            face_id: id.clone(),
            persistent_name: id,
            is_flat,
            positions,
            normals,
            indices,
        });
    }
    Ok(out)
}

/// Convert opencascade-rs's `Mesh` (DVec3 vertices + normals, usize indices)
/// into the three flat f32/u32 arrays the frontend renders. Normals come
/// straight from OCCT's `Poly_Triangulation_Normal` so we don't have to
/// recompute them.
fn flatten_mesh(mesh: &opencascade::mesh::Mesh) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let mut positions = Vec::with_capacity(mesh.vertices.len() * 3);
    for v in &mesh.vertices {
        positions.push(v.x as f32);
        positions.push(v.y as f32);
        positions.push(v.z as f32);
    }
    let mut normals = Vec::with_capacity(mesh.normals.len() * 3);
    for n in &mesh.normals {
        normals.push(n.x as f32);
        normals.push(n.y as f32);
        normals.push(n.z as f32);
    }
    // If OCCT's normals slice is shorter than vertices (it sometimes lags by
    // one due to opencascade-rs's `1..(length as usize)` loop — see the
    // `TODO(bschwind) - Why do we start at 1 here?` comment in mesh.rs),
    // pad with zeros so positions/normals stay aligned.
    while normals.len() < positions.len() {
        normals.push(0.0);
    }
    let indices: Vec<u32> = mesh.indices.iter().map(|&i| i as u32).collect();
    (positions, normals, indices)
}

fn looks_flat(normals: &[f32]) -> bool {
    if normals.len() < 6 {
        return true;
    }
    let nx0 = normals[0]; let ny0 = normals[1]; let nz0 = normals[2];
    let tol = 1e-3_f32;
    for i in (3..normals.len()).step_by(3) {
        let nx = normals[i]; let ny = normals[i + 1]; let nz = normals[i + 2];
        if (nx * nx0 + ny * ny0 + nz * nz0 - 1.0).abs() > tol {
            return false;
        }
    }
    true
}

// ────────────────────────────────────────────────────────────────────────────
// Topology + BREP
// ────────────────────────────────────────────────────────────────────────────

fn extract_topology(shape: &Shape) -> Topology {
    // opencascade-rs exposes shape.edges() (not shape.vertices()). Derive
    // vertex positions from each edge's start + end points and dedupe. This
    // is enough for Phase 0; Phase 1 will add persistent edge naming + curve
    // type metadata (line vs arc vs spline) once the per-feature graph
    // tracks dependencies on specific edges.
    let mut vertices: Vec<TopologyVertex> = Vec::new();
    let mut edges: Vec<TopologyEdge> = Vec::new();
    let mut seen_v: std::collections::HashSet<[i64; 3]> = std::collections::HashSet::new();
    let mut v_id_counter = 0usize;

    fn quantize(v: DVec3) -> [i64; 3] {
        // 1e-6 quantization step — enough to dedupe shared endpoints without
        // collapsing distinct vertices in normal-sized models.
        const STEP: f64 = 1.0e6;
        [(v.x * STEP).round() as i64, (v.y * STEP).round() as i64, (v.z * STEP).round() as i64]
    }

    for (e_idx, edge) in shape.edges().enumerate() {
        let start = edge.start_point();
        let end = edge.end_point();
        for p in [start, end] {
            let key = quantize(p);
            if seen_v.insert(key) {
                vertices.push(TopologyVertex {
                    id: format!("v{}", v_id_counter),
                    position: [p.x, p.y, p.z],
                });
                v_id_counter += 1;
            }
        }
        edges.push(TopologyEdge {
            id: format!("e{}", e_idx),
            is_straight: true,  // TODO Phase 1: edge.edge_type() match → curve metadata
            endpoints: [[start.x, start.y, start.z], [end.x, end.y, end.z]],
        });
    }
    Topology { vertices, edges }
}

fn serialize_brep(shape: &Shape) -> Vec<u8> {
    // opencascade-rs exposes write_brep_text/_bin only on paths. For Phase 0
    // we round-trip through a temp file; Phase 1 either upstreams an
    // in-memory writer or drops to opencascade-sys directly. The text form
    // is what Phase 1's BinTools swap will replace.
    let tmp = std::env::temp_dir().join(format!(
        "letwinventory-cad-kernel-{}.brep",
        std::process::id()
    ));
    if let Err(e) = shape.write_brep_text(&tmp).context("write BREP to temp file") {
        warn!(error = ?e, "BREP serialization unavailable (Phase 1 fixes this)");
        return Vec::new();
    }
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_drops_consecutive_coincident_points() {
        let input = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let out = dedup_consecutive(input);
        assert_eq!(out, vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    }

    #[test]
    fn dedup_drops_wrap_around_duplicate() {
        // Last vertex sits on top of the first → closing edge would be 0-length.
        let input = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)];
        let out = dedup_consecutive(input);
        assert_eq!(out, vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    }

    #[test]
    fn shoelace_is_positive_for_ccw_unit_square() {
        let ccw = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        assert!(signed_polygon_area(&ccw) > 0.0);
    }

    #[test]
    fn shoelace_is_negative_for_cw_unit_square() {
        let cw = vec![(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)];
        assert!(signed_polygon_area(&cw) < 0.0);
    }

    #[test]
    fn validate_rejects_zero_length_edge() {
        let bad = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 0.0), (0.0, 1.0)];
        assert!(validate_polygon(&bad).is_err());
    }

    #[test]
    fn validate_accepts_ccw_rectangle() {
        let ok = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)];
        assert!(validate_polygon(&ok).is_ok());
    }
}
