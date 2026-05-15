//! `buildExtrude` — turn a typed profile + host plane into a tessellated
//! extruded solid via OCCT (through the `opencascade` crate).
//!
//! Phase 0 scope: handles `line` and `circle` profile edges. `arc` edges
//! fall back to a chord-tessellated polyline approximation; Phase 1 wires
//! arcs to `gp_Circ` + `BRepBuilderAPI_MakeEdge` properly.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use opencascade::{
    primitives::{IntoShape, Shape},
    workplane::Workplane,
};
use tracing::warn;

use crate::naming::PersistentName;
use crate::protocol::{
    BuildExtrudeParams, BuildExtrudeResult, FaceMesh, Plane3, Point2, ProfileEdge,
    Topology, TopologyVertex,
};

/// Chord tolerance for triangulation, in model units. Match the frontend's
/// tessellator (`DEFAULT_CHORD_TOLERANCE = 0.05`) so the server-side mesh
/// matches what the sketch-editor preview shows.
const DEFAULT_CHORD_TOLERANCE: f64 = 0.05;

pub fn build(params: &BuildExtrudeParams) -> Result<BuildExtrudeResult> {
    let signed_distance = if params.flipped { -params.distance } else { params.distance };

    // Build the host workplane. opencascade-rs's `Workplane` ergonomics are
    // close to CadQuery's: origin + normal direction + in-plane x-axis.
    let workplane = build_workplane(&params.plane)?;

    // Build the planar face that we'll extrude.
    let face = build_profile_face(&workplane, &params.profile)?;

    // Extrude along plane.normal * signed_distance.
    let nx = params.plane.normal[0] * signed_distance;
    let ny = params.plane.normal[1] * signed_distance;
    let nz = params.plane.normal[2] * signed_distance;
    let solid = face.extrude(glam::dvec3(nx, ny, nz));
    let shape: Shape = solid.into_shape();

    // Tessellate and classify each OCCT face by axial position so we can
    // assign cap-top / cap-bottom / side persistent names.
    let faces = tessellate_and_name(&shape, &params.plane, signed_distance, &params.feature_id)?;
    let topology = extract_topology(&shape);
    let brep_bytes = serialize_brep(&shape);

    Ok(BuildExtrudeResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces,
        topology,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

fn build_workplane(plane: &Plane3) -> Result<Workplane> {
    // Workplane::new takes the local x-axis + normal; together they define
    // the orientation. y-axis is implied as normal × x_axis (right-handed).
    // origin is then translated separately.
    let x = glam::dvec3(plane.x_axis[0], plane.x_axis[1], plane.x_axis[2]);
    let n = glam::dvec3(plane.normal[0], plane.normal[1], plane.normal[2]);
    let origin = glam::dvec3(plane.origin[0], plane.origin[1], plane.origin[2]);
    Ok(Workplane::new(x, n).set_translation(origin))
}

fn build_profile_face(
    wp: &Workplane,
    profile: &[ProfileEdge],
) -> Result<opencascade::primitives::Face> {
    if profile.is_empty() {
        return Err(anyhow!("profile is empty"));
    }
    // Fast path: a single `circle` edge IS the loop (no need to walk).
    if profile.len() == 1 {
        if let ProfileEdge::Circle { center, radius } = &profile[0] {
            let wire = wp.clone().circle(center.x, center.y, *radius);
            return Ok(wire.to_face());
        }
    }

    // General case: collect 2D polyline points from the edges. Arcs/circles
    // mixed into a polygon profile are flagged: arcs get a chord
    // approximation (Phase 0 limitation), embedded circles are an error.
    let mut points: Vec<(f64, f64)> = Vec::with_capacity(profile.len());
    for edge in profile {
        match edge {
            ProfileEdge::Line { start, .. } => {
                points.push((start.x, start.y));
            }
            ProfileEdge::Arc { start, .. } => {
                // TODO Phase 1: emit a real arc edge instead of skipping the
                // sweep. For now we only record the start point and let the
                // polygon walk produce a chord across the arc — visually
                // wrong but the topology is closed.
                warn!("arc profile edge encountered; Phase 0 falls back to chord");
                points.push((start.x, start.y));
            }
            ProfileEdge::Circle { .. } => {
                return Err(anyhow!(
                    "'circle' edge mixed into a polygon profile is invalid; circles must be the sole edge"
                ));
            }
        }
    }
    if points.len() < 3 {
        return Err(anyhow!(
            "profile must have at least 3 edges to form a closed polygon, got {}",
            points.len()
        ));
    }
    let mut builder = wp.clone();
    builder = builder.move_to(points[0].0, points[0].1);
    for (x, y) in points.iter().skip(1) {
        builder = builder.line_to(*x, *y);
    }
    Ok(builder.close().to_face())
}

#[derive(Debug, Clone, Copy)]
enum FaceKind {
    CapBottom,
    CapTop,
    Side,
}

fn tessellate_and_name(
    shape: &Shape,
    plane: &Plane3,
    signed_distance: f64,
    feature_id: &str,
) -> Result<Vec<FaceMesh>> {
    let nx = plane.normal[0];
    let ny = plane.normal[1];
    let nz = plane.normal[2];

    // Pre-pass: classify each OCCT face by where its centroid sits along the
    // normal axis. Cap-bottom = axial≈0; cap-top = axial≈signed_distance;
    // everything else = side.
    let tol = (signed_distance.abs() * 1e-3).max(1e-6);
    let mut classified: Vec<(FaceKind, opencascade::primitives::Face, f64, f64)> = Vec::new();
    for face in shape.faces() {
        let mesh = face.mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE);
        if mesh.vertices.is_empty() {
            continue;
        }
        // Mean vertex position — good-enough centroid for classification.
        let mut cx = 0.0_f64;
        let mut cy = 0.0_f64;
        let mut cz = 0.0_f64;
        for v in &mesh.vertices {
            cx += v.x;
            cy += v.y;
            cz += v.z;
        }
        let n_verts = mesh.vertices.len() as f64;
        cx /= n_verts;
        cy /= n_verts;
        cz /= n_verts;
        let axial = (cx - plane.origin[0]) * nx
            + (cy - plane.origin[1]) * ny
            + (cz - plane.origin[2]) * nz;
        let kind = if (axial - 0.0).abs() <= tol {
            FaceKind::CapBottom
        } else if (axial - signed_distance).abs() <= tol {
            FaceKind::CapTop
        } else {
            FaceKind::Side
        };
        // Compute an "angular" key for side faces: angle of (centroid - axis
        // origin) projected to plane. Used only for stable ordering.
        let dx = cx - plane.origin[0];
        let dy = cy - plane.origin[1];
        let xx = plane.x_axis[0] * dx + plane.x_axis[1] * dy + plane.x_axis[2] * (cz - plane.origin[2]);
        let yy = plane.y_axis[0] * dx + plane.y_axis[1] * dy + plane.y_axis[2] * (cz - plane.origin[2]);
        let angle = yy.atan2(xx);
        classified.push((kind, face, axial, angle));
    }
    // Stable sort: caps (bottom, then top) bracket the sides; sides sorted
    // by angle around the axis so side `0` is consistent across regens.
    classified.sort_by(|a, b| {
        let order_a = match a.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        let order_b = match b.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        order_a.cmp(&order_b).then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut side_index = 0_u32;
    let mut out = Vec::with_capacity(classified.len());
    for (kind, face, _axial, _angle) in classified {
        let mesh = face.mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE);
        let (positions, normals, indices) = mesh_to_flat_arrays(&mesh);
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

/// Convert an opencascade `Mesh` into the three flat arrays the frontend
/// already consumes (matches `FaceMesh` in `frontend/src/app/cad/lib/types.ts`).
/// Normals are accumulated per-vertex from triangle face-normals then
/// normalized — same averaging the pre-pivot pure-JS kernel did, so curved
/// lateral faces look smooth-shaded.
fn mesh_to_flat_arrays(
    mesh: &opencascade::mesh::Mesh,
) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let n_verts = mesh.vertices.len();
    let n_tris = mesh.indices.len() / 3;
    let mut positions = Vec::with_capacity(n_verts * 3);
    for v in &mesh.vertices {
        positions.push(v.x as f32);
        positions.push(v.y as f32);
        positions.push(v.z as f32);
    }
    let mut indices = Vec::with_capacity(mesh.indices.len());
    for i in &mesh.indices {
        indices.push(*i as u32);
    }
    let mut normals = vec![0.0_f32; n_verts * 3];
    for t in 0..n_tris {
        let ia = indices[t * 3] as usize;
        let ib = indices[t * 3 + 1] as usize;
        let ic = indices[t * 3 + 2] as usize;
        let ax = positions[ia * 3]; let ay = positions[ia * 3 + 1]; let az = positions[ia * 3 + 2];
        let bx = positions[ib * 3]; let by = positions[ib * 3 + 1]; let bz = positions[ib * 3 + 2];
        let cx = positions[ic * 3]; let cy = positions[ic * 3 + 1]; let cz = positions[ic * 3 + 2];
        let ux = bx - ax; let uy = by - ay; let uz = bz - az;
        let vx = cx - ax; let vy = cy - ay; let vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        for idx in [ia, ib, ic] {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
        }
    }
    for i in 0..n_verts {
        let nx = normals[i * 3];
        let ny = normals[i * 3 + 1];
        let nz = normals[i * 3 + 2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        if len > 0.0 {
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        }
    }
    (positions, normals, indices)
}

/// Heuristic: a face is flat when every vertex normal is parallel to the
/// first one (dot ≈ 1). Caps and rectangle-side faces pass; cylinder-side
/// faces fail because their normals fan around the axis.
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

fn extract_topology(shape: &Shape) -> Topology {
    // Phase 0 emits only vertex IDs + positions; persistent edge naming +
    // straightness detection arrive in Phase 1 alongside the proper arc
    // handling.
    let mut vertices = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    for (i, v) in shape.vertices().enumerate() {
        let p = v.point();
        let id = format!("v{}", i);
        if seen.insert(id.clone()) {
            vertices.push(TopologyVertex {
                id,
                position: [p.x, p.y, p.z],
            });
        }
    }
    Topology { vertices, edges: vec![] }
}

fn serialize_brep(shape: &Shape) -> Vec<u8> {
    // opencascade-rs exposes write_brep(path) — for Phase 0 we write to a
    // temp file and read it back. Phase 1 swaps to an in-memory BinTools
    // writer once we either wrap it ourselves or upstream adds it.
    let tmp = std::env::temp_dir().join(format!(
        "letwinventory-cad-kernel-{}.brep",
        std::process::id()
    ));
    if let Err(e) = shape.write_brep(&tmp).context("write BREP to temp file") {
        warn!(error = ?e, "BREP serialization unavailable (Phase 1 fixes this)");
        return Vec::new();
    }
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    bytes
}

// Phase 0 spike doesn't need its own arc tessellation — that lives in
// `frontend/src/app/cad/lib/tessellator.ts` for the sketch-editor preview,
// and Phase 1 will route arc edges through OCCT's analytic arc builders
// (gp_Circ + BRepBuilderAPI_MakeEdge) so the kernel never needs to
// pre-tessellate them either.
#[allow(dead_code)]
fn placeholder() -> &'static [Point2] {
    &[]
}
