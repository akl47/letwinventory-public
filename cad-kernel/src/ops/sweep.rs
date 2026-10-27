//! `buildSweep` — drag a sketched profile face along a 3D path wire to
//! produce a solid. Mirrors `buildExtrude` / `buildRevolve` end-to-end:
//! the outer profile face is built on the profile sketch's host plane,
//! the path is assembled from typed edges in world coords, then
//! `Face::sweep_along` (OCCT's `BRepOffsetAPI_MakePipe`) does the
//! transport.
//!
//! Holes in the profile produce hole-tubes that are boolean-subtracted
//! from the outer swept solid. CompoundFace doesn't expose sweep_along
//! in the vendored binding, so we do the boolean ourselves rather than
//! plumb a new FFI surface for it.

use anyhow::{anyhow, Result};
use glam::dvec3;
use opencascade::{
    primitives::{Edge, Shape, Wire},
};
use tracing::info;

use crate::ops::extrude::{build_profile_face, build_workplane};
use crate::ops::shape_io::{
    brep_to_base64, extract_topology, serialize_brep,
};
use crate::protocol::{BuildSweepParams, BuildSweepResult, PathEdge};

pub fn build(params: &BuildSweepParams) -> Result<BuildSweepResult> {
    info!(
        feature_id = %params.feature_id,
        profile_edges = params.profile.len(),
        holes = params.holes.len(),
        path_edges = params.path_edges.len(),
        "buildSweep dispatching",
    );

    if params.profile.is_empty() {
        return Err(anyhow!("sweep profile is empty"));
    }
    if params.path_edges.is_empty() {
        return Err(anyhow!("sweep path is empty"));
    }

    let path = build_path_wire(&params.path_edges)?;
    let workplane = build_workplane(&params.profile_plane);
    let outer_face = build_profile_face(&workplane, &params.profile)?;
    // sweep_along_shell uses BRepOffsetAPI_MakePipeShell which accepts
    // paths with sharp corners (line-to-line at an angle). The simpler
    // MakePipe / sweep_along requires a C1-continuous path and throws
    // StdFail_NotDone for anything else — a C++ exception that would
    // abort the kernel process. Returns None on builder failure so we
    // surface a clean error instead.
    let outer_solid = outer_face.sweep_along_shell(&path).ok_or_else(|| anyhow!(
        "sweep failed: OCCT couldn't build the swept solid. Common causes: \
         profile coplanar with the path's start tangent, path crosses itself, \
         or the profile is too large for the path's first turn radius."
    ))?;
    let mut shape: Shape = outer_solid.into();

    // Subtract any hole-tubes one at a time. For each hole loop, sweep
    // the hole's face along the same path to get a tube-solid, then
    // boolean-cut it from the running outer solid. clean() after each
    // subtract merges co-domain faces so the tube and outer surfaces
    // don't leave seam edges along their tangent contact.
    for hole_edges in &params.holes {
        let hole_face = build_profile_face(&workplane, hole_edges)
            .map_err(|e| anyhow!("sweep: hole profile invalid: {e}"))?;
        let hole_solid = hole_face.sweep_along_shell(&path).ok_or_else(|| anyhow!(
            "sweep: hole couldn't be swept along the path (likely too large for a path turn)."
        ))?;
        let hole_shape: Shape = hole_solid.into();
        let cut = shape.subtract(&hole_shape);
        let raw: Shape = cut.into();
        shape = raw.clean();
    }

    let raw_face_count = shape.faces().count();
    let raw_edge_count = shape.edges().count();
    info!(
        feature_id = %params.feature_id,
        raw_face_count,
        raw_edge_count,
        "sweep: raw shape before tessellation",
    );

    let topology = extract_topology(&shape);
    let faces = crate::ops::shape_io::tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
    let brep_bytes = serialize_brep(&shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildSweep: result BRep serialization returned empty bytes. \
             Likely degenerate input (profile coplanar with path tangent, \
             or path with self-intersections)."
        ));
    }

    Ok(BuildSweepResult {
        brep_bytes: brep_to_base64(&brep_bytes),
        faces,
        topology,
    })
}

/// Build the path Wire from the typed edge list. Lines map to
/// `Edge::segment`, three-point arcs to `Edge::arc`, and lone circles to
/// `Edge::circle` (closed path). Edges arrive in chain order, so
/// `Wire::from_edges` connects them via the OCCT MakeWire builder.
fn build_path_wire(edges: &[PathEdge]) -> Result<Wire> {
    // Single-circle path: closed loop, one OCCT edge.
    if edges.len() == 1 {
        if let PathEdge::Circle { center, radius, normal } = &edges[0] {
            if *radius <= 1e-9 {
                return Err(anyhow!("sweep path: circle radius must be > 0"));
            }
            let c = dvec3(center[0], center[1], center[2]);
            let n = dvec3(normal[0], normal[1], normal[2]);
            let circle_edge = Edge::circle(c, n, *radius);
            return Ok(Wire::from_edges([&circle_edge]));
        }
    }

    let mut occt_edges: Vec<Edge> = Vec::with_capacity(edges.len());
    for (i, edge) in edges.iter().enumerate() {
        match edge {
            PathEdge::Line { start, end } => {
                let a = dvec3(start[0], start[1], start[2]);
                let b = dvec3(end[0], end[1], end[2]);
                if (b - a).length_squared() < 1e-18 {
                    return Err(anyhow!("sweep path: line segment {} is zero-length", i));
                }
                occt_edges.push(Edge::segment(a, b));
            }
            PathEdge::Arc { start, mid, end } => {
                let a = dvec3(start[0], start[1], start[2]);
                let m = dvec3(mid[0], mid[1], mid[2]);
                let b = dvec3(end[0], end[1], end[2]);
                // Collinear three points → degenerate (OCCT throws).
                let ab = b - a;
                let am = m - a;
                let cross = ab.cross(am);
                if cross.length_squared() < 1e-12 {
                    return Err(anyhow!(
                        "sweep path: arc {} has collinear start/mid/end (degenerate)",
                        i,
                    ));
                }
                occt_edges.push(Edge::arc(a, m, b));
            }
            PathEdge::Circle { .. } => {
                return Err(anyhow!(
                    "sweep path: circle segments only allowed as a single-edge closed path",
                ));
            }
        }
    }
    Ok(Wire::from_edges(occt_edges.iter()))
}
