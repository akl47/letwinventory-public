//! `buildEdgeBlend` — apply a fillet (round) or chamfer (45° bevel) to
//! a set of edges on an existing body BREP.
//!
//! Edges are identified by their two world-space endpoint coordinates.
//! The kernel iterates the input shape's edges and matches the one whose
//! endpoints are closest to the picked endpoints (in either pairing).
//! Geometry-based matching is robust to OCCT's per-call edge re-numbering
//! that happens whenever a shape goes through a boolean operation.
//!
//! Fillet uses OCCT's BRepFilletAPI_MakeFillet (a 3D fillet that produces
//! a rolling-ball blend); chamfer uses BRepFilletAPI_MakeChamfer with
//! equal leg distances on both sides (the 45° equal-distance mode).
//! Variable-radius fillet and asymmetric chamfer come in a later pass.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use tracing::info;

use crate::ops::shape_io::{
    decompose_into_solids, deserialize_brep_from_base64, extract_topology, serialize_brep,
};
use crate::protocol::{BuildEdgeBlendParams, BuildEdgeBlendResult, ChamferMode, EdgeBlendKind, EdgeRef};

pub fn build(params: &BuildEdgeBlendParams) -> Result<BuildEdgeBlendResult> {
    info!(
        feature_id = %params.feature_id,
        kind = ?params.kind,
        value = params.value,
        edge_count = params.edges.len(),
        "buildEdgeBlend dispatching",
    );
    if params.edges.is_empty() {
        return Err(anyhow!("buildEdgeBlend: at least one edge must be picked"));
    }
    if !params.value.is_finite() || params.value <= 0.0 {
        return Err(anyhow!(
            "buildEdgeBlend: value must be a positive number (got {})",
            params.value
        ));
    }
    let body = deserialize_brep_from_base64(&params.a_brep)
        .context("buildEdgeBlend: decoding input BREP")?;

    // Match each picked endpoint pair to an OCCT edge by closest combined
    // distance — either direct (pickedStart↔edgeStart) or swapped — and
    // collect the body edges + indices. Tolerance scales with the model's
    // geometry; we use a generous 1mm + 0.1% of the bounding diagonal so
    // the matcher copes with kernel-side endpoint drift across booleans.
    // Edge isn't Clone (it owns a UniquePtr), so we keep the snapshot
    // around and pass &Edge references into the blend API.
    let body_edges: Vec<opencascade::primitives::Edge> = body.edges().collect();
    let indices = match_picked_edges(&body_edges, &params.edges)
        .context("buildEdgeBlend: matching picked edges to body edges")?;
    info!(matched = indices.len(), requested = params.edges.len(), "edges matched");
    // Build per-edge (value, edge-ref) pairs so each picked edge can carry
    // its own radius / distance override. Edges with no override fall back
    // to the feature-level `params.value`.
    let mut per_edge: Vec<(f64, &opencascade::primitives::Edge)> = Vec::with_capacity(indices.len());
    for (req_idx, &body_idx) in indices.iter().enumerate() {
        let v = params.edges[req_idx].value.unwrap_or(params.value);
        if !v.is_finite() || v <= 0.0 {
            return Err(anyhow!(
                "buildEdgeBlend: edge {} per-edge value {} must be positive and finite",
                req_idx, v
            ));
        }
        per_edge.push((v, &body_edges[body_idx]));
    }
    info!(
        mixed = per_edge.iter().any(|(v, _)| (v - params.value).abs() > 1e-9),
        "per-edge values resolved",
    );

    let shape = match params.kind {
        EdgeBlendKind::Fillet => body.fillet_edges_per(per_edge.iter().map(|(v, e)| (*v, *e))),
        EdgeBlendKind::Chamfer => match params.chamfer_mode {
            ChamferMode::Equal => {
                body.chamfer_edges_per(per_edge.iter().map(|(v, e)| (*v, *e)))
            }
            ChamferMode::TwoDistance => {
                let d2 = params.distance2.ok_or_else(|| anyhow!(
                    "buildEdgeBlend: chamfer mode 'twoDistance' requires `distance2`"
                ))?;
                if !d2.is_finite() || d2 <= 0.0 {
                    return Err(anyhow!(
                        "buildEdgeBlend: distance2 must be positive and finite (got {})",
                        d2,
                    ));
                }
                // Reference face per edge — the first adjacent face we
                // find. opencascade-rs Face isn't Clone, so we keep the
                // snapshot around and pass &Face into the chamfer API
                // through indices, same pattern as body_edges.
                let body_faces: Vec<opencascade::primitives::Face> = body.faces().collect();
                let face_indices = find_adjacent_faces(&body_edges, &indices, &body_faces)?;
                let items: Vec<(f64, f64, &opencascade::primitives::Edge, &opencascade::primitives::Face)> =
                    per_edge.iter().enumerate().map(|(i, &(d1, e))| {
                        (d1, d2, e, &body_faces[face_indices[i]])
                    }).collect();
                body.chamfer_edges_two_distance(items.into_iter())
            }
            ChamferMode::DistanceAngle => {
                let deg = params.angle.ok_or_else(|| anyhow!(
                    "buildEdgeBlend: chamfer mode 'distanceAngle' requires `angle`"
                ))?;
                if !deg.is_finite() || deg <= 0.0 || deg >= 90.0 {
                    return Err(anyhow!(
                        "buildEdgeBlend: angle must be in (0°, 90°) (got {}°)",
                        deg,
                    ));
                }
                let radians = deg.to_radians();
                let body_faces: Vec<opencascade::primitives::Face> = body.faces().collect();
                let face_indices = find_adjacent_faces(&body_edges, &indices, &body_faces)?;
                let items: Vec<(f64, f64, &opencascade::primitives::Edge, &opencascade::primitives::Face)> =
                    per_edge.iter().enumerate().map(|(i, &(d, e))| {
                        (d, radians, e, &body_faces[face_indices[i]])
                    }).collect();
                body.chamfer_edges_distance_angle(items.into_iter())
            }
        },
    };

    let topology = extract_topology(&shape);
    let faces = crate::ops::shape_io::tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
    let brep_bytes = serialize_brep(&shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildEdgeBlend: result BRep is empty — the {} likely failed \
             (radius/distance too large for one of the picked edges, or \
             the edges are adjacent in a way OCCT can't blend).",
            match params.kind { EdgeBlendKind::Fillet => "fillet", EdgeBlendKind::Chamfer => "chamfer" },
        ));
    }
    let solids = decompose_into_solids(&shape, &params.feature_id)?;

    Ok(BuildEdgeBlendResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces,
        topology,
        solids,
    })
}

/// Match each picked EdgeRef (a pair of world-space endpoints) to one
/// edge in `body_edges`. Returns matched INDICES — the caller keeps the
/// snapshot Vec alive and dereferences by index when calling the OCCT
/// blend API.
fn match_picked_edges(
    body_edges: &[opencascade::primitives::Edge],
    picks: &[EdgeRef],
) -> Result<Vec<usize>> {
    if body_edges.is_empty() {
        return Err(anyhow!("input body has no edges to fillet/chamfer"));
    }
    // Compute a tolerance that scales with the model size — 0.1% of the
    // body's bounding diagonal, floored at 1mm. Generous because the
    // upstream re-projection paths can drift endpoints a hair across
    // booleans.
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for e in body_edges {
        for p in [e.start_point(), e.end_point()] {
            let v = [p.x, p.y, p.z];
            for i in 0..3 {
                if v[i] < min[i] { min[i] = v[i]; }
                if v[i] > max[i] { max[i] = v[i]; }
            }
        }
    }
    let diag = ((max[0] - min[0]).powi(2) + (max[1] - min[1]).powi(2) + (max[2] - min[2]).powi(2)).sqrt();
    let tol = (diag * 1e-3).max(1.0);

    let mut out = Vec::with_capacity(picks.len());
    for (i, p) in picks.iter().enumerate() {
        let mut best_idx: Option<usize> = None;
        let mut best_score = f64::INFINITY;
        for (j, edge) in body_edges.iter().enumerate() {
            let es = edge.start_point();
            let ee = edge.end_point();
            let direct = dist(&p.start, [es.x, es.y, es.z]) + dist(&p.end, [ee.x, ee.y, ee.z]);
            let swap   = dist(&p.start, [ee.x, ee.y, ee.z]) + dist(&p.end, [es.x, es.y, es.z]);
            let score  = direct.min(swap);
            if score < best_score { best_score = score; best_idx = Some(j); }
        }
        match best_idx {
            Some(j) if best_score <= tol * 2.0 => out.push(j),
            _ => return Err(anyhow!(
                "buildEdgeBlend: picked edge {} (endpoints {:?} → {:?}) didn't match any \
                 body edge within tolerance {:.3} (closest was {:.3}). The body may have \
                 changed enough that this edge no longer exists — re-pick.",
                i, p.start, p.end, tol * 2.0, best_score,
            )),
        }
    }
    Ok(out)
}

fn dist(a: &[f64; 3], b: [f64; 3]) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// For each picked edge, find one face in the body that is topologically
/// adjacent to it. Used by asymmetric / distance-angle chamfer modes
/// where OCCT needs a reference face. We match by endpoint coincidence:
/// iterate every face's edges, find the first whose endpoints (in either
/// pairing) match the picked edge within a tight tolerance, return that
/// face's index.
///
/// Returns `Vec<face_index>` parallel to `picked_indices` (so element `i`
/// is the reference face for `body_edges[picked_indices[i]]`).
fn find_adjacent_faces(
    body_edges: &[opencascade::primitives::Edge],
    picked_indices: &[usize],
    body_faces: &[opencascade::primitives::Face],
) -> Result<Vec<usize>> {
    const TOL: f64 = 1.0e-4;
    let close = |a: [f64; 3], b: [f64; 3]| -> bool {
        (a[0] - b[0]).abs() < TOL && (a[1] - b[1]).abs() < TOL && (a[2] - b[2]).abs() < TOL
    };
    let mut out = Vec::with_capacity(picked_indices.len());
    for (req_idx, &edge_idx) in picked_indices.iter().enumerate() {
        let edge = &body_edges[edge_idx];
        let es = edge.start_point();
        let ee = edge.end_point();
        let e_start = [es.x, es.y, es.z];
        let e_end = [ee.x, ee.y, ee.z];
        let mut found: Option<usize> = None;
        'faces: for (face_idx, face) in body_faces.iter().enumerate() {
            for face_edge in face.edges() {
                let fs = face_edge.start_point();
                let fe = face_edge.end_point();
                let f_start = [fs.x, fs.y, fs.z];
                let f_end = [fe.x, fe.y, fe.z];
                let direct = close(e_start, f_start) && close(e_end, f_end);
                let swap = close(e_start, f_end) && close(e_end, f_start);
                if direct || swap {
                    found = Some(face_idx);
                    break 'faces;
                }
            }
        }
        match found {
            Some(i) => out.push(i),
            None => return Err(anyhow!(
                "buildEdgeBlend: picked edge {} has no adjacent face in the body — \
                 cannot apply asymmetric or angle chamfer. Edge endpoints: ({:.3}, {:.3}, {:.3}) → ({:.3}, {:.3}, {:.3})",
                req_idx, es.x, es.y, es.z, ee.x, ee.y, ee.z,
            )),
        }
    }
    Ok(out)
}
