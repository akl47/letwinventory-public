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
    brep_to_base64, extract_topology, serialize_brep, tessellate_faces_generic,
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
    // `Some(angle)` for a partial revolve; `None` means 360° in opencascade-rs.
    // We always pass Some(angle) because the angle_deg field is unconditional.
    let angle = Some(Angle::Degrees(params.angle_deg));

    let workplane = build_workplane(&params.plane);
    let shape: Shape = if params.holes.is_empty() {
        let face = build_profile_face(&workplane, &params.profile)?;
        face.revolve(axis_origin, axis_dir, angle).into()
    } else {
        let compound = build_compound_face_with_holes(&workplane, &params.profile, &params.holes)?;
        compound.revolve(axis_origin, axis_dir, angle)
    };

    let faces = tessellate_faces_generic(&shape, &params.feature_id)?;
    let topology = extract_topology(&shape);
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
