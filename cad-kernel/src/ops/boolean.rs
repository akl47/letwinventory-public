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

    let result = match params.op {
        BuildBooleanOp::Fuse  => a.union(&b),
        BuildBooleanOp::Cut   => a.subtract(&b),
        BuildBooleanOp::Common => a.intersect(&b),
    };
    // BooleanShape → Shape. The conversion is a From impl in opencascade-rs.
    let raw: opencascade::primitives::Shape = result.into();
    // Boolean ops can split a single analytic surface into many sub-faces
    // wherever the other shape's vertices, edges, or seams cross it —
    // e.g. revolving against a cube produces pie-slice sub-faces on the
    // revolve's lateral surface that radiate from each cube vertex. The
    // sub-faces are visually identical to the original surface but each
    // gets its own perimeter rendered, looking like spurious tessellation
    // lines on a smooth surface. `clean()` (ShapeUpgrade_UnifySameDomain
    // with all three unify flags) merges co-domain adjacents and drops
    // the spurious edges.
    let shape = raw.clean();

    let topology = extract_topology(&shape);
    let faces = crate::ops::shape_io::tessellate_faces_generic_with_topology(&shape, &params.feature_id, Some(&topology))?;
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
    let solids = decompose_into_solids(&shape, &params.feature_id)?;
    info!(
        feature_id = %params.feature_id,
        solid_count = solids.len(),
        "buildBoolean: decomposed into N solids",
    );

    Ok(BuildBooleanResult {
        brep_bytes: brep_to_base64(&brep_bytes),
        faces,
        topology,
        solids,
    })
}
