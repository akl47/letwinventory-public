//! `buildBoolean` — apply a boolean op (Fuse / Cut / Common) to two
//! input shapes serialized as base64-encoded BREP. Returns the resulting
//! shape's BREP + a generic face tessellation + topology.
//!
//! Used by the backend's cumulative-shape pipeline:
//! - Fuse: union an additive Extrude prism into the cumulative body.
//! - Cut: subtract a CutExtrude prism from the cumulative body.
//! - Common: reserved for Up to Body / future intersect-based ops.
//!
//! Face IDs in the result are deterministic (centroid-sort order) so
//! they survive small parameter tweaks. Topological renames after a
//! topology change (a face appearing / disappearing) require the proper
//! topological-naming module — deferred.

use anyhow::{anyhow, Result};
use tracing::info;

use crate::ops::shape_io::{
    brep_to_base64, decompose_into_solids, deserialize_brep_from_base64, extract_topology,
    serialize_brep,
};
use crate::protocol::{BuildBooleanOp, BuildBooleanParams, BuildBooleanResult};

pub fn build(params: &BuildBooleanParams) -> Result<BuildBooleanResult> {
    info!(
        op = ?params.op,
        feature_id = %params.feature_id,
        a_bytes = params.a_brep.len(),
        b_bytes = params.b_brep.len(),
        "buildBoolean dispatching",
    );
    let a = deserialize_brep_from_base64(&params.a_brep)?;
    let b = deserialize_brep_from_base64(&params.b_brep)?;

    // Stage-boundary timing (REQ — diagnose pathological booleans). Logs a
    // "starting"/"done" pair per stage so that when the op-watchdog force-kills
    // the process mid-stage, the LAST "starting … " line with no matching "done"
    // pinpoints which stage hung (union vs clean vs tessellate vs decompose).
    info!(feature_id = %params.feature_id, stage = "union", "buildBoolean: starting stage");
    let t_union = std::time::Instant::now();
    let raw: opencascade::primitives::Shape = match params.op {
        BuildBooleanOp::Fuse => fuse_avoiding_clean_hang(&a, &b, &params.feature_id),
        BuildBooleanOp::Cut   => a.subtract(&b).into(),
        BuildBooleanOp::Common => a.intersect(&b).into(),
    };
    info!(feature_id = %params.feature_id, stage = "union", ms = t_union.elapsed().as_millis() as u64, "buildBoolean: stage done");
    // Boolean ops can split a single analytic surface into many sub-faces
    // wherever the other shape's vertices, edges, or seams cross it —
    // e.g. revolving against a cube produces pie-slice sub-faces on the
    // revolve's lateral surface that radiate from each cube vertex. The
    // sub-faces are visually identical to the original surface but each
    // gets its own perimeter rendered, looking like spurious tessellation
    // lines on a smooth surface. `clean()` (ShapeUpgrade_UnifySameDomain
    // with all three unify flags) merges co-domain adjacents and drops
    // the spurious edges.
    info!(feature_id = %params.feature_id, stage = "clean", "buildBoolean: starting stage");
    let t_clean = std::time::Instant::now();
    let shape = raw.clean();
    info!(feature_id = %params.feature_id, stage = "clean", ms = t_clean.elapsed().as_millis() as u64, "buildBoolean: stage done");

    info!(feature_id = %params.feature_id, stage = "topology", "buildBoolean: starting stage");
    let t_topo = std::time::Instant::now();
    let topology = extract_topology(&shape);
    info!(feature_id = %params.feature_id, stage = "topology", ms = t_topo.elapsed().as_millis() as u64, "buildBoolean: stage done");

    info!(feature_id = %params.feature_id, stage = "tessellate", "buildBoolean: starting stage");
    let t_tess = std::time::Instant::now();
    let faces = crate::ops::shape_io::tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
    info!(feature_id = %params.feature_id, stage = "tessellate", ms = t_tess.elapsed().as_millis() as u64, "buildBoolean: stage done");
    let brep_bytes = serialize_brep(&shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildBoolean: result BRep serialization returned empty bytes — \
             OCCT couldn't write the resulting shape. Likely degenerate \
             input (e.g. cutting a body in a way that produces zero volume)."
        ));
    }

    // SolidWorks-style body tracking: decompose the result into its
    // independent disjoint solids. >1 means the op split a body into
    // pieces; the backend uses the per-solid info to assign persistent
    // body ids (largest piece keeps the original, others become new
    // bodies). 0 means the op annihilated the body (cut that produced
    // empty volume) — backend handles that as a body deletion.
    info!(feature_id = %params.feature_id, stage = "decompose", "buildBoolean: starting stage");
    let t_dec = std::time::Instant::now();
    let solids = decompose_into_solids(&shape, &params.feature_id)?;
    info!(
        feature_id = %params.feature_id,
        solid_count = solids.len(),
        ms = t_dec.elapsed().as_millis() as u64,
        "buildBoolean: decomposed into N solids",
    );

    Ok(BuildBooleanResult {
        brep_bytes: brep_to_base64(&brep_bytes),
        faces,
        topology,
        solids,
    })
}

/// Fuse `a ∪ b` while avoiding the `UnifySameDomain` (`clean()`) hang that the
/// plain `union` triggers on COINCIDENT-FACE fuses.
///
/// When an additive prism meets the body flush at a shared planar face (e.g.
/// extruding the same sketch regions up while they were extruded down — the
/// up-prism sits on the sketch plane against the down-extrude), the plain
/// `BRepAlgoAPI_Fuse` leaves a near-coincident co-domain face pair that makes
/// the downstream `clean()` loop for minutes (the watchdog then kills the
/// kernel). OCCT's GlueShift mode fuses those coincident faces *during* the
/// boolean, so the result has no such pair and `clean()` runs normally.
///
/// Glue is only correct when the operands TOUCH (no shared volume). We detect
/// genuine overlap by volume — a glued fuse of overlapping solids double-counts
/// the overlap, so `vol(glued) > vol(a) + vol(b) - ε` only holds for a pure
/// touch. On overlap we fall back to the plain union (overlap fuses produce a
/// real intersection curve, not the coincident-face pathology, so `clean()` is
/// well-behaved there).
fn fuse_avoiding_clean_hang(
    a: &opencascade::primitives::Shape,
    b: &opencascade::primitives::Shape,
    feature_id: &str,
) -> opencascade::primitives::Shape {
    let glued = a.union_glued(b);
    let (va, _) = a.volume_centroid();
    let (vb, _) = b.volume_centroid();
    let (vg, _) = glued.volume_centroid();
    // Touch ⇒ vol(glued) == va + vb (no shared volume). Overlap ⇒ glued
    // double-counts, so vol(glued) noticeably exceeds the true union volume,
    // which is < va + vb. Relative tolerance keeps it scale-independent.
    let touching = (vg - (va + vb)).abs() <= 1e-4 * (va + vb).abs().max(1.0);
    if touching {
        info!(feature_id = %feature_id, va, vb, vg, "buildBoolean: fuse via GlueShift (coincident-face touch)");
        glued
    } else {
        info!(feature_id = %feature_id, va, vb, vg, "buildBoolean: operands overlap — plain union");
        a.union(b).into()
    }
}
