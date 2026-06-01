//! `buildShell` — hollow a solid by removing one or more "open" faces
//! and offsetting the remaining faces by a signed wall thickness.
//!
//! Inputs identify the faces-to-remove geometrically (centroid + outward
//! normal) rather than by persistent face ID, mirroring the approach the
//! edge-blend op uses for edges. OCCT regenerates face IDs across every
//! boolean / transform, so a geometry-keyed match is the only way to
//! pin a pick to a face that survives regens without fragile snapshot
//! bookkeeping.
//!
//! Implementation calls `Shape::shell` on the deserialized source — a
//! thin wrapper around `BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin`
//! that does the offset + reconstruction in one OCCT call.
//!
//! Per-face thickness overrides land in a follow-up: OCCT's
//! `MakeThickSolidByJoin` is single-thickness; per-face requires the
//! lower-level `Initialize` + `SetOffsetOnFace` path which isn't in the
//! cxx FFI yet. The `ShellFaceRef.thickness` field accepts the override
//! today so we can swap in the per-face path without a protocol change.

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tracing::info;

use crate::ops::shape_io::{
    decompose_into_solids, deserialize_brep_from_base64, extract_topology, serialize_brep,
    tessellate_faces_generic_with_topology,
};
use crate::protocol::{BuildShellParams, BuildShellResult, ShellFaceRef};

pub fn build(params: &BuildShellParams) -> Result<BuildShellResult> {
    info!(
        feature_id = %params.feature_id,
        face_count = params.faces.len(),
        thickness = params.thickness,
        tolerance = params.tolerance,
        "buildShell dispatching",
    );
    if params.faces.is_empty() {
        return Err(anyhow!(
            "buildShell: at least one face must be picked as the open / removed face"
        ));
    }
    if !params.thickness.is_finite() || params.thickness == 0.0 {
        return Err(anyhow!(
            "buildShell: thickness must be a non-zero finite number (got {}). \
             Positive = outward; negative = inward.",
            params.thickness,
        ));
    }
    if !params.tolerance.is_finite() || params.tolerance <= 0.0 {
        return Err(anyhow!(
            "buildShell: tolerance must be a positive finite number (got {})",
            params.tolerance,
        ));
    }

    let body = deserialize_brep_from_base64(&params.a_brep)
        .context("buildShell: decoding input BREP")?;

    // Snapshot the body's faces so picked refs can map by index into a
    // stable list. Face isn't Clone (UniquePtr inside); we iterate
    // once, sort by the same centroid order tessellate_faces uses, and
    // then resolve picks geometrically.
    let body_faces: Vec<opencascade::primitives::Face> = body.faces().collect();
    if body_faces.is_empty() {
        return Err(anyhow!(
            "buildShell: input body has no faces to remove. Source BREP is likely empty."
        ));
    }
    let indices = match_picked_faces(&body_faces, &params.faces)
        .context("buildShell: matching picked faces to body faces")?;
    info!(matched = indices.len(), requested = params.faces.len(), "faces matched");

    // Collect the matched faces (as &Face) for the shell call. We do
    // NOT yet honor per-face thickness — see module docs.
    let removed: Vec<&opencascade::primitives::Face> =
        indices.iter().map(|&i| &body_faces[i]).collect();

    // `Shape::shell` wraps BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin
    // which throws Standard_Failure on infeasible offsets — the FFI
    // now returns Result so OCCT exceptions become a Rust Err instead
    // of std::terminate aborting the kernel process. Map the inner
    // error message into a user-friendly hint at the top of the chain.
    let shape = body
        .shell(
            removed.iter().copied(),
            params.thickness,
            params.tolerance,
        )
        .map_err(|e| anyhow!(
            "buildShell: failed to build the shell. The body's geometry \
             could not be hollowed at the requested thickness ({} mm). \
             Try a smaller thickness, or simplify the body near the \
             picked faces. (Kernel detail: {})",
            params.thickness, e,
        ))?;

    let brep_bytes = serialize_brep(&shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildShell: result BRep serialization returned empty bytes — OCCT \
             could not write the shelled body. Most common cause: the requested \
             thickness ({} mm) is too large for the body's narrowest dimension, \
             producing self-intersecting offset surfaces.",
            params.thickness,
        ));
    }
    let topology = extract_topology(&shape);
    let faces = tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
    let solids = decompose_into_solids(&shape, &params.feature_id)?;

    Ok(BuildShellResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces,
        topology,
        solids,
    })
}

/// Match each picked face ref (centroid + outward normal) to one face
/// in `body_faces`. Returns matched INDICES so the caller can keep the
/// body_faces snapshot alive and dereference by index — Face isn't
/// Clone in the vendored opencascade crate.
fn match_picked_faces(
    body_faces: &[opencascade::primitives::Face],
    picks: &[ShellFaceRef],
) -> Result<Vec<usize>> {
    // Tolerance: a generous 1mm + 0.1% of the bounding diagonal,
    // matching the edge-blend matcher's scaling. Booleans can drift
    // face centroids a hair across regens; better to over-match than
    // miss the pick.
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for face in body_faces {
        let c = face.center_of_mass();
        for i in 0..3 {
            let v = [c.x, c.y, c.z][i];
            if v < min[i] { min[i] = v; }
            if v > max[i] { max[i] = v; }
        }
    }
    let diag = ((max[0] - min[0]).powi(2) + (max[1] - min[1]).powi(2) + (max[2] - min[2]).powi(2)).sqrt();
    let pos_tol = (diag * 1.0e-3).max(1.0);  // mm

    let mut out = Vec::with_capacity(picks.len());
    for (pick_idx, pick) in picks.iter().enumerate() {
        let mut best: Option<(usize, f64)> = None;
        for (i, face) in body_faces.iter().enumerate() {
            let c = face.center_of_mass();
            let dx = c.x - pick.centroid[0];
            let dy = c.y - pick.centroid[1];
            let dz = c.z - pick.centroid[2];
            let d = (dx * dx + dy * dy + dz * dz).sqrt();
            // Tie-break by normal alignment when centroids are within
            // tolerance — two parallel faces of a thin plate can share
            // an XY centroid; the normal direction breaks the tie.
            let normal = face.normal_at(c);
            let dot = normal.x * pick.normal[0] + normal.y * pick.normal[1] + normal.z * pick.normal[2];
            // Score: distance penalty + small normal-misalignment bump
            // when distance is ambiguous. Lower is better.
            let score = d - 0.1 * dot.max(0.0);
            match best {
                None => best = Some((i, score)),
                Some((_, prev)) if score < prev => best = Some((i, score)),
                _ => {}
            }
        }
        let (idx, dist) = best.ok_or_else(|| anyhow!(
            "buildShell: no body faces to match against (empty face list?)"
        ))?;
        if dist > pos_tol {
            return Err(anyhow!(
                "buildShell: picked face {} (centroid {:?}) has no match within {} mm \
                 in the body — closest face is {} mm away. The body may have changed \
                 shape upstream; re-pick the face.",
                pick_idx, pick.centroid, pos_tol, dist,
            ));
        }
        out.push(idx);
    }
    // Reject duplicate matches — two picks resolving to the same body
    // face means the user double-picked. Removing the same face twice
    // would feed MakeThickSolid a malformed list.
    let mut seen: Vec<usize> = Vec::with_capacity(out.len());
    for &idx in &out {
        if seen.contains(&idx) {
            return Err(anyhow!(
                "buildShell: two picked faces resolved to the same body face (index {}). \
                 Remove the duplicate from the pick list.",
                idx,
            ));
        }
        seen.push(idx);
    }
    Ok(out)
}
