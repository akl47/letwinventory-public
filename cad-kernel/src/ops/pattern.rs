//! `buildPattern` — apply N transforms to a source BREP, then fuse
//! the transformed copies (and optionally the source) into a single
//! result body. Used by:
//!   - **Mirror Feature** — one mirror-plane transform; merge with
//!     source default true (the output is the original PLUS its
//!     reflection fused into one body).
//!   - **Linear Pattern** — one translate transform per copy along a
//!     direction (or two crossed directions for the 2-axis pattern).
//!   - **Circular Pattern** — one rotation transform per copy around
//!     a shared axis.
//!
//! All three pattern kinds reduce to "list of transforms + fuse" so
//! the kernel exposes a single op; the frontend computes the
//! transform list from each feature's parameters.
//!
//! `mergeWithSource: false` produces a body containing JUST the
//! transformed copies (the source stays as its own body upstream).
//! The default `true` fuses everything into the cumulative body —
//! matches SolidWorks's pattern-feature-on-existing-body behavior.

use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use glam::dvec3;
use tracing::info;

use crate::ops::shape_io::{
    decompose_into_solids, deserialize_brep_from_base64, extract_topology, serialize_brep,
    tessellate_faces_generic_with_topology,
};
use crate::protocol::{BuildPatternParams, BuildPatternResult, PatternTransform};

pub fn build(params: &BuildPatternParams) -> Result<BuildPatternResult> {
    info!(
        feature_id = %params.feature_id,
        transform_count = params.transforms.len(),
        merge_with_source = params.merge_with_source,
        "buildPattern dispatching",
    );
    if params.transforms.is_empty() {
        return Err(anyhow!(
            "buildPattern: no transforms supplied — a pattern with zero copies has nothing to do"
        ));
    }
    let source = deserialize_brep_from_base64(&params.a_brep)?;

    // Build every transformed copy as its own Shape. We don't fuse
    // incrementally — accumulating booleans across many copies is
    // expensive and can fail mid-chain; fusing pairwise into a tree
    // is slightly faster overall but harder to read. For Phase 1,
    // fuse copies into the result one at a time, starting from
    // either the source (default) or the first copy.
    let copies: Vec<opencascade::primitives::Shape> = params.transforms.iter().map(|t| {
        apply_transform(&source, t)
    }).collect();

    let result_shape = if params.merge_with_source {
        // Start by fusing the source with the first copy, then fold
        // each remaining copy into the running result. Shape doesn't
        // implement Clone (it owns a UniquePtr to OCCT data), so we
        // bootstrap the accumulator with the first BooleanShape →
        // Shape conversion rather than cloning the source itself.
        let mut copies_iter = copies.iter();
        let first = copies_iter.next().expect("transforms non-empty");
        let mut acc: opencascade::primitives::Shape = source.union(first).into();
        for copy in copies_iter {
            let fused: opencascade::primitives::Shape = acc.union(copy).into();
            acc = fused;
        }
        acc.clean()
    } else {
        // Skip the source; fuse copies among themselves into a new
        // free-floating body. Counts >= 1 always (we errored above on 0).
        let mut iter = copies.into_iter();
        let first = iter.next().expect("transforms non-empty");
        let mut acc = first;
        for copy in iter {
            let fused: opencascade::primitives::Shape = acc.union(&copy).into();
            acc = fused;
        }
        acc.clean()
    };

    let brep_bytes = serialize_brep(&result_shape);
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "buildPattern: result BRep serialization returned empty bytes — \
             OCCT could not write the fused result. One or more transforms \
             may have produced a degenerate body (e.g. mirror across a plane \
             that passes through the source so the reflection overlaps it \
             entirely, or rotate by 0° giving N coincident copies)."
        ));
    }
    let topology = extract_topology(&result_shape);
    let faces = tessellate_faces_generic_with_topology(&result_shape, &params.feature_id, Some(&topology))?;
    let solids = decompose_into_solids(&result_shape, &params.feature_id)?;

    Ok(BuildPatternResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces,
        topology,
        solids,
    })
}

/// Convert a single PatternTransform into the shape it produces by
/// applying that transform to `source`. The Shape methods do the
/// gp_Trsf construction + BRepBuilderAPI_Transform internally —
/// see `vendor/opencascade-rs/.../shape.rs` `translate_xyz`,
/// `rotate_around`, `mirror_plane`.
fn apply_transform(source: &opencascade::primitives::Shape, t: &PatternTransform) -> opencascade::primitives::Shape {
    match t {
        PatternTransform::Translate { dx, dy, dz } => source.translate_xyz(*dx, *dy, *dz),
        PatternTransform::Rotate { origin, direction, angle_rad } => {
            source.rotate_around(
                dvec3(origin[0], origin[1], origin[2]),
                dvec3(direction[0], direction[1], direction[2]),
                *angle_rad,
            )
        }
        PatternTransform::Mirror { origin, normal } => {
            source.mirror_plane(
                dvec3(origin[0], origin[1], origin[2]),
                dvec3(normal[0], normal[1], normal[2]),
            )
        }
    }
}
