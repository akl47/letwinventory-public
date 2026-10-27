//! `buildFeaturePattern` — repeat a SEED FEATURE's geometric effect at N
//! transformed instances. Unlike `buildPattern` (which copies a finished body),
//! this re-applies what the seed feature *did* to the body, computed as a
//! geometry delta from the body state just before and after the seed:
//!
//!   removed = before − after   (material the feature carved away)
//!   added   = after  − before  (material the feature added)
//!
//! For each copy transform `Tᵢ`:  body = (body − Tᵢ(removed)) ∪ Tᵢ(added).
//!
//! This is correct for every feature type — extrude / cut-extrude / revolve /
//! cut-revolve / sweep / cut-sweep / loft / hole / fillet / chamfer / shell —
//! with one code path (SolidWorks "geometry pattern"). The source instance is
//! already present in `body`; `transforms` carries only the N−1 copies.

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use opencascade::primitives::Shape;
use tracing::info;

use crate::ops::pattern::apply_transform;
use crate::ops::shape_io::{
    decompose_into_solids, deserialize_brep_from_base64, extract_topology, serialize_brep,
    tessellate_faces_generic_with_topology,
};
use crate::protocol::{BuildFeaturePatternParams, BuildPatternResult, BuildToolPatternParams};

/// `buildToolPattern` — TRUE feature pattern for a tool-based seed (extrude /
/// cut / revolve / sweep / loft). Re-runs the seed's actual boolean at every
/// instance: transform the seed's tool solid by `Tᵢ` and fuse-or-cut it into
/// the EVOLVING body. Because each instance composes against the live body,
/// feature interactions are exact (unlike the geometry-delta path, which unions
/// pre-computed deltas and loses inter-feature boundaries). The source instance
/// is already in `body`; `transforms` carries only the N−1 copies.
pub fn build_tool_pattern(params: &BuildToolPatternParams) -> Result<BuildPatternResult> {
    info!(
        feature_id = %params.feature_id,
        transform_count = params.transforms.len(),
        fuse = params.fuse,
        "buildToolPattern dispatching",
    );
    if params.transforms.is_empty() {
        return Err(anyhow!("buildToolPattern: no transforms supplied"));
    }
    let mut body = deserialize_brep_from_base64(&params.body_brep).context("decode body BREP")?;
    let tool = deserialize_brep_from_base64(&params.tool_brep).context("decode tool BREP")?;
    if is_empty(&tool) {
        return Err(anyhow!("buildToolPattern: seed tool is empty — nothing to repeat"));
    }

    for t in &params.transforms {
        let tool_i = apply_transform(&tool, t);
        body = if params.fuse {
            body.union(&tool_i).into()
        } else {
            body.subtract(&tool_i).into()
        };
    }

    let result_shape = body.clean();
    let brep_bytes = serialize_brep(&result_shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildToolPattern: result BRep serialization returned empty bytes — the pattern may \
             have removed the entire body."
        ));
    }
    let topology = extract_topology(&result_shape);
    let faces =
        tessellate_faces_generic_with_topology(&result_shape, &params.feature_id, Some(&topology))?;
    let solids = decompose_into_solids(&result_shape, &params.feature_id)?;
    Ok(BuildPatternResult { brep_bytes: BASE64.encode(&brep_bytes), faces, topology, solids })
}

/// A shape is "empty" (no material) when it has no vertices — e.g. a pure
/// additive feature's `removed` delta, or a pure cut's `added` delta.
fn is_empty(s: &Shape) -> bool {
    extract_topology(s).vertices.is_empty()
}

pub fn build(params: &BuildFeaturePatternParams) -> Result<BuildPatternResult> {
    info!(
        feature_id = %params.feature_id,
        transform_count = params.transforms.len(),
        "buildFeaturePattern dispatching",
    );
    if params.transforms.is_empty() {
        return Err(anyhow!(
            "buildFeaturePattern: no transforms supplied — a pattern with zero copies has \
             nothing to do"
        ));
    }

    let after = deserialize_brep_from_base64(&params.after_brep).context("decode after BREP")?;
    let mut body = deserialize_brep_from_base64(&params.body_brep).context("decode body BREP")?;

    // `before` is absent/empty for a body-seeding feature (nothing was removed;
    // the whole `after` is the added material).
    let before_opt = match &params.before_brep {
        Some(b) if !b.is_empty() => {
            Some(deserialize_brep_from_base64(b).context("decode before BREP")?)
        }
        _ => None,
    };

    // Geometry delta. `after` is consumed only in the None branch.
    let removed: Option<Shape>;
    let added: Shape;
    match &before_opt {
        Some(before) => {
            removed = Some(before.subtract(&after).into());
            added = after.subtract(before).into();
        }
        None => {
            removed = None;
            added = after;
        }
    }

    // Drop empty deltas so we never feed OCCT booleans a null operand.
    let removed = removed.filter(|s| !is_empty(s));
    let added_nonempty = !is_empty(&added);
    if removed.is_none() && !added_nonempty {
        return Err(anyhow!(
            "buildFeaturePattern: the seed feature produced no geometry change to repeat — \
             check that the seed actually adds or removes material"
        ));
    }

    // Re-apply the delta at every instance via a SINGLE boolean per delta:
    // group all transformed copies into one compound, then carve/fill once.
    // Folding instances in one-at-a-time re-tolerances the whole body per
    // instance and accumulates fuzzy sliver loss at coincident seams (e.g. a
    // mirror plane), which under-reports the resulting volume. One BOP over the
    // compound resolves all seams in a single pass.
    if let Some(removed) = &removed {
        let copies: Vec<Shape> = params.transforms.iter().map(|t| apply_transform(removed, t)).collect();
        let tool = Shape::compound_of(copies.iter());
        body = body.subtract(&tool).into();
    }
    if added_nonempty {
        let copies: Vec<Shape> = params.transforms.iter().map(|t| apply_transform(&added, t)).collect();
        let tool = Shape::compound_of(copies.iter());
        // Glued fuse — pattern/mirror copies meet the body (and each other) at
        // exactly-coincident faces; GlueShift fuses them without the fuzzy
        // intersection that otherwise shaves slivers and under-reports volume.
        body = body.union_glued(&tool);
    }

    let result_shape = body.clean();
    let brep_bytes = serialize_brep(&result_shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildFeaturePattern: result BRep serialization returned empty bytes — the pattern \
             may have removed the entire body (e.g. overlapping cut instances)."
        ));
    }
    let topology = extract_topology(&result_shape);
    let faces =
        tessellate_faces_generic_with_topology(&result_shape, &params.feature_id, Some(&topology))?;
    let solids = decompose_into_solids(&result_shape, &params.feature_id)?;

    Ok(BuildPatternResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces,
        topology,
        solids,
    })
}
