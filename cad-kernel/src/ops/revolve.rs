//! `buildRevolve` — rotate a sketched profile around a world-space axis
//! to produce a body of revolution. Mirrors `buildExtrude` end-to-end:
//! the profile face is built on the host plane (with optional inner-loop
//! holes via CompoundFace), then `Face::revolve` (or
//! `CompoundFace::revolve`) produces the swept solid. A full 360°
//! revolve of a closed profile yields a watertight solid.
//!
//! The axis is passed as world-space origin + direction (NOT plane-
//! local) because the backend resolves it from a sketched line whose
//! 3D coords come straight from the sketch plane projection.

use anyhow::{anyhow, Result};
use glam::dvec3;
use opencascade::{
    angle::Angle,
    primitives::Shape,
};
use tracing::info;

use crate::ops::extrude::{build_compound_face_with_holes, build_profile_face, build_workplane};
use crate::ops::shape_io::{
    brep_to_base64, extract_topology, serialize_brep,
};
use crate::protocol::{BuildRevolveParams, BuildRevolveResult};

pub fn build(params: &BuildRevolveParams) -> Result<BuildRevolveResult> {
    info!(
        feature_id = %params.feature_id,
        angle_deg = params.angle_deg,
        holes = params.holes.len(),
        "buildRevolve dispatching",
    );

    if params.profile.is_empty() {
        return Err(anyhow!("revolve profile is empty"));
    }
    let axis_dir_len = (
        params.axis_dir[0] * params.axis_dir[0]
        + params.axis_dir[1] * params.axis_dir[1]
        + params.axis_dir[2] * params.axis_dir[2]
    ).sqrt();
    if axis_dir_len < 1e-9 {
        return Err(anyhow!(
            "revolve axis direction is degenerate (zero-length vector). \
             Check that the sketched axis line has distinct endpoints."
        ));
    }
    let axis_origin = dvec3(params.axis_origin[0], params.axis_origin[1], params.axis_origin[2]);
    let axis_dir = dvec3(
        params.axis_dir[0] / axis_dir_len,
        params.axis_dir[1] / axis_dir_len,
        params.axis_dir[2] / axis_dir_len,
    );
    // For a full 360° revolution, `None` triggers opencascade-rs's true-
    // closed revolve: the resulting surface wraps parametrically, the
    // start and end positions of the profile collapse into the SAME
    // boundary, and the source profile's edges don't survive as
    // standalone topology edges. `Some(360°)` instead does a partial
    // revolve that happens to be 360° — OCCT keeps the start-position
    // and end-position profile edges as separate entities in the BRep
    // even though they coincide geometrically, leaving visible seam-
    // like edges (e.g. polyline kinks from the sketch) baked into the
    // result. Anything within 0.001° of 360 is treated as full.
    let is_full = (params.angle_deg - 360.0).abs() < 1.0e-3;
    let angle = if is_full { None } else { Some(Angle::Degrees(params.angle_deg)) };
    info!(
        feature_id = %params.feature_id,
        angle_deg_input = params.angle_deg,
        is_full,
        will_use_constructor = if is_full { "no-angle (closed)" } else { "with-angle (partial)" },
        profile_pts = params.profile.len(),
        holes = params.holes.len(),
        "revolve: classifying angle",
    );

    let workplane = build_workplane(&params.plane);
    // Face/CompoundFace::revolve now returns Option — None means OCCT
    // threw (caught by cxx via Result<UniquePtr<...>>). Surface that as
    // a clean human-readable error instead of letting the kernel abort.
    let revolve_err = || anyhow!(
        "revolve failed: OCCT couldn't build the swept solid. Common causes: \
         profile coincident with the rotation axis, axis crosses the profile \
         interior, or degenerate / self-intersecting profile."
    );
    let shape: Shape = if params.holes.is_empty() {
        let face = build_profile_face(&workplane, &params.profile)?;
        let solid = face.revolve(axis_origin, axis_dir, angle).ok_or_else(revolve_err)?;
        solid.into()
    } else {
        let compound = build_compound_face_with_holes(&workplane, &params.profile, &params.holes)?;
        compound.revolve(axis_origin, axis_dir, angle).ok_or_else(revolve_err)?
    };

    // Dump face + edge counts of the raw revolve result before clean()
    // and before topology extraction, so we can see what OCCT produced.
    let raw_face_count = shape.faces().count();
    let raw_edge_count = shape.edges().count();
    info!(
        feature_id = %params.feature_id,
        raw_face_count,
        raw_edge_count,
        "revolve: raw shape before tessellation",
    );

    let topology = extract_topology(&shape);
    let faces = crate::ops::shape_io::tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
    info!(
        feature_id = %params.feature_id,
        emitted_face_count = faces.len(),
        emitted_edge_count = topology.edges.len(),
        emitted_vertex_count = topology.vertices.len(),
        "revolve: after tessellation + topology extract",
    );
    let brep_bytes = serialize_brep(&shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildRevolve: result BRep serialization returned empty bytes. \
             Likely degenerate input (e.g. profile coincident with the axis)."
        ));
    }

    Ok(BuildRevolveResult {
        brep_bytes: brep_to_base64(&brep_bytes),
        faces,
        topology,
    })
}
