//! `buildExtrude` — turn a typed profile + host plane into a tessellated
//! extruded solid via OCCT (through the `opencascade` crate).
//!
//! Handles `line`, `arc`, and `circle` profile edges. Arcs use
//! `Sketch::three_point_arc` with the midpoint computed from the protocol's
//! (centre, radius, startAngle, endAngle, ccw) so the resulting face has a
//! true analytic arc edge rather than a chord approximation.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use glam::{dvec3, DVec3};
use opencascade::{
    primitives::{CompoundFace, Edge, Face, Shape, Solid, Wire},
    workplane::Workplane,
};
use tracing::{info, warn};

use crate::naming::PersistentName;
use crate::protocol::{
    BuildExtrudeParams, BuildExtrudeResult, BuildLoftParams, FaceMesh, Plane3, ProfileEdge,
    Topology, TopologyEdge, TopologyVertex,
};

/// Chord tolerance for triangulation, in model units. Match the frontend's
/// tessellator (`DEFAULT_CHORD_TOLERANCE = 0.05`) so the server-side mesh
/// matches what the sketch-editor preview shows.
const DEFAULT_CHORD_TOLERANCE: f64 = 0.05;

pub fn build(params: &BuildExtrudeParams) -> Result<BuildExtrudeResult> {
    // "Up To Body" / "Up To Next" end conditions: terminate the extrude against
    // one (body) or all (next) upstream bodies so the end conforms to a real
    // surface. Distinct enough from the blind/dir-2 prism path to live in its
    // own builder.
    let has_until_breps = params.until_breps.as_ref().map_or(false, |v| !v.is_empty());
    if params.until_brep.is_some() || has_until_breps {
        return build_up_to_body(params);
    }
    let plane_normal = dvec3(params.plane.normal[0], params.plane.normal[1], params.plane.normal[2]);

    // Resolve direction 2's signed magnitude up front, so we can fold it
    // into a SINGLE prism rather than fusing two prisms post-hoc. Fusing
    // two prisms via Shape::union leaves the shared start face as an
    // internal seam (OCCT's UnifySameDomain pass doesn't reliably merge
    // it across the parting plane), which renders as a visible parting
    // ring around the result. Folding into one prism — translate the
    // start back by d2, extrude the whole (d1 + d2) length — produces
    // exactly the same volume with no internal seam.
    const THROUGH_ALL_FALLBACK: f64 = 1.0e4;
    let d2_magnitude: f64 = match &params.direction2 {
        Some(d2) if d2.kind == "throughAll" => THROUGH_ALL_FALLBACK,
        Some(d2) => d2.distance,
        None => 0.0,
    };

    // Direction 1's signed extent along the plane normal.
    let d1_signed = if params.flipped { -params.distance } else { params.distance };
    // Direction 2 grows the OPPOSITE way from direction 1.
    let d2_signed = if params.flipped { d2_magnitude } else { -d2_magnitude };
    // Translate the start by (start_offset + d2_signed) along the normal,
    // then extrude by the TOTAL length in direction-1's direction. The
    // total length is |d1| + |d2| (the two pieces stacked), signed by
    // direction 1.
    let effective_start = params.start_offset + d2_signed;
    let total_signed = d1_signed - d2_signed;  // |d1| + |d2| with d1's sign

    let mut offset_plane = params.plane.clone();
    if effective_start != 0.0 {
        offset_plane.origin = [
            params.plane.origin[0] + plane_normal.x * effective_start,
            params.plane.origin[1] + plane_normal.y * effective_start,
            params.plane.origin[2] + plane_normal.z * effective_start,
        ];
    }
    let workplane = build_workplane(&offset_plane);

    let extrude_dir = dvec3(
        plane_normal.x * total_signed,
        plane_normal.y * total_signed,
        plane_normal.z * total_signed,
    );
    let shape: Shape = build_prism(&workplane, &params.profile, &params.holes, extrude_dir)?;

    let plane_origin = dvec3(params.plane.origin[0], params.plane.origin[1], params.plane.origin[2]);
    // Naming continues to reference the original sketch-plane origin and
    // direction-1's signed distance — same persistent ids across saves.
    let topology = extract_topology(&shape);
    let faces_out = tessellate_and_name(&shape, plane_origin, plane_normal, d1_signed, &params.feature_id, Some(&topology))?;
    let brep_bytes = serialize_brep(&shape);

    Ok(BuildExtrudeResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces: faces_out,
        topology,
    })
}

/// "Up To Body" / "Up To Next" extrude: extrude the profile along the plane
/// normal (in the `flipped` direction, starting from `start_offset`) far enough
/// to reach the target(s), subtract them, and keep the start-adjacent solid
/// piece. With one target (`untilBrep`) this is "Up To Body"; with all upstream
/// bodies (`untilBreps`) it is "Up To Next" — the kept piece caps at whichever
/// body the profile reaches FIRST. The end face conforms to the body's real
/// surface (curved/angled supported). Errors when no target is in the extrude
/// direction or the profile doesn't fully land on one.
fn build_up_to_body(params: &BuildExtrudeParams) -> Result<BuildExtrudeResult> {
    // Collect all targets: the single body (Up To Body) and/or every upstream
    // body (Up To Next). Both are subtracted; the start-adjacent piece caps at
    // the nearest.
    let mut targets: Vec<Shape> = Vec::new();
    if let Some(b64) = params.until_brep.as_ref() {
        targets.push(
            crate::ops::shape_io::deserialize_brep_from_base64(b64)
                .context("up-to: decode target body BREP")?,
        );
    }
    if let Some(list) = params.until_breps.as_ref() {
        for (i, b64) in list.iter().enumerate() {
            targets.push(
                crate::ops::shape_io::deserialize_brep_from_base64(b64)
                    .with_context(|| format!("up-to: decode upstream body BREP #{i}"))?,
            );
        }
    }
    if targets.is_empty() {
        return Err(anyhow!("up-to: no target body provided"));
    }

    let plane_normal =
        dvec3(params.plane.normal[0], params.plane.normal[1], params.plane.normal[2]).normalize();
    // Extrude direction along the normal, reversed when `flipped`. The user's
    // Reverse toggle picks which side the target body is on.
    let dir_sign = if params.flipped { -1.0 } else { 1.0 };
    let dir = plane_normal * dir_sign;

    // Start plane = sketch plane translated by start_offset along the normal.
    let start_origin =
        dvec3(params.plane.origin[0], params.plane.origin[1], params.plane.origin[2])
            + plane_normal * params.start_offset;
    let mut start_plane = params.plane.clone();
    start_plane.origin = [start_origin.x, start_origin.y, start_origin.z];
    let workplane = build_workplane(&start_plane);

    // Direction sanity check: at least one target must lie on the extrude side.
    // Vertices only bound the SIGN here — magnitude is NOT used to size the
    // prism (a curved far surface, e.g. a D-profile arc, can reach past every
    // vertex), so this stays correct for curved targets.
    let mut d_far_hint = f64::MIN;
    for t in &targets {
        for v in &extract_topology(t).vertices {
            let p = dvec3(v.position[0], v.position[1], v.position[2]) - start_origin;
            d_far_hint = d_far_hint.max(p.dot(dir));
        }
    }
    if d_far_hint <= 1e-6 {
        return Err(anyhow!(
            "Up to Body/Next: no target body lies in the extrude direction. Try Reverse."
        ));
    }

    // Build a through-all prism (the codebase's "infinity" extent) and let the
    // boolean subtract cap it at the body's REAL surface — so the end conforms
    // exactly regardless of curvature, with no reliance on the body's bounds.
    // Subtracting EVERY target means the kept start-side piece caps at the
    // nearest one (this is what makes "Up To Next" stop at the first surface).
    const THROUGH_ALL_LEN: f64 = 1.0e4;
    let prism: Shape = build_prism(&workplane, &params.profile, &params.holes, dir * THROUGH_ALL_LEN)?;
    let mut cut: Shape = prism;
    for t in &targets {
        cut = cut.subtract(t).shape;
    }

    // Keep the solid piece(s) adjacent to the start plane (min projection ≈ 0).
    // The piece beyond the body (and any inside-body gap) is dropped — its near
    // end sits at the body's far surface, far from the start.
    let tol = 1.0e-3;
    let mut kept: Vec<Shape> = Vec::new();
    for solid in cut.solids() {
        let sh: Shape = solid.into();
        let topo = extract_topology(&sh);
        let mut min_proj = f64::MAX;
        for v in &topo.vertices {
            let p = dvec3(v.position[0], v.position[1], v.position[2]) - start_origin;
            min_proj = min_proj.min(p.dot(dir));
        }
        if min_proj <= tol {
            kept.push(sh);
        }
    }
    if kept.is_empty() {
        return Err(anyhow!(
            "Up to Body: could not build a solid up to the target body. Re-pick the target."
        ));
    }
    let mut result = kept.remove(0);
    for s in &kept {
        result = result.union(s).shape;
    }

    // Guard: a kept piece still running the full through-all length means the
    // boolean never capped it — the profile missed the body, or only partly
    // covers it (the uncovered part leaves a full-length sliver). Reject so the
    // user fixes the profile/target instead of getting a 10 m spike. Computed on
    // the up-to piece ALONE, before any Direction-2 material is added.
    let mut max_proj = f64::MIN;
    for v in &extract_topology(&result).vertices {
        let p = dvec3(v.position[0], v.position[1], v.position[2]) - start_origin;
        max_proj = max_proj.max(p.dot(dir));
    }
    if max_proj > THROUGH_ALL_LEN - 1.0 {
        return Err(anyhow!(
            "Up to Body: the profile does not fully land on the target body. \
             The whole profile must lie within the body's footprint along the extrude direction."
        ));
    }

    // Direction 2 (optional): a blind / through-all prism growing the OPPOSITE
    // way from the up-to direction, unioned in. Direction 2 itself is never an
    // up-to condition (the UI doesn't offer it), so it's always a fixed length.
    // The shared start-plane face becomes internal after the union.
    if let Some(d2) = &params.direction2 {
        const THROUGH_ALL_FALLBACK: f64 = 1.0e4;
        let d2_mag = if d2.kind == "throughAll" { THROUGH_ALL_FALLBACK } else { d2.distance };
        if d2_mag.abs() > 1e-9 {
            let d2_prism = build_prism(&workplane, &params.profile, &params.holes, dir * (-d2_mag))?;
            result = result.union(&d2_prism).shape;
        }
    }

    // Heal the up-to result before naming: merge coplanar / co-cylindrical
    // faces and drop the redundant seam edges the through-all subtraction +
    // Direction-2 union leave behind. The other result-producing ops
    // (buildBoolean, buildToolPattern) already clean(); this path didn't, so
    // its prism carried spurious seam + degenerate edges that ALSO replicated
    // through feature patterns. clean() preserves geometry/extent, so the
    // max_proj-based naming below stays valid.
    let result = result.clean();
    let topology = extract_topology(&result);
    let plane_origin = dvec3(params.plane.origin[0], params.plane.origin[1], params.plane.origin[2]);
    // Naming references the original sketch-plane origin + a signed extent so
    // the start cap classifies consistently with blind extrudes. Use the actual
    // capped extent (max_proj), not the through-all length.
    let signed_distance = dir_sign * max_proj;
    let faces_out = tessellate_and_name(
        &result,
        plane_origin,
        plane_normal,
        signed_distance,
        &params.feature_id,
        Some(&topology),
    )?;
    let brep_bytes = serialize_brep(&result);
    // Mirror the sibling result-producing ops (boolean/sweep/pattern): a
    // degenerate up-to result can serialize to empty bytes, which must surface
    // as an error rather than be stored/encoded as a "successful" empty BRep.
    if brep_bytes.is_empty() {
        return Err(anyhow!(
            "Up to Body: result BRep serialization returned empty bytes — the \
             capped solid is degenerate (the profile may not reach the target \
             in this direction). Re-pick the target or drop this region."
        ));
    }

    Ok(BuildExtrudeResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces: faces_out,
        topology,
    })
}

/// `buildLoft` — loft a solid through two or more ordered profile sections.
/// Each section's profile is built into a face via the same path extrude uses,
/// then its outer wire feeds OCCT `BRepOffsetAPI_ThruSections` (Solid::loft).
/// Result shape matches BuildExtrudeResult so the backend composer is
/// indifferent to which op produced the body.
pub fn build_loft(params: &BuildLoftParams) -> Result<BuildExtrudeResult> {
    if params.sections.len() < 2 {
        return Err(anyhow!(
            "loft needs at least 2 profile sections, got {}",
            params.sections.len()
        ));
    }
    let mut wires: Vec<opencascade::primitives::Wire> = Vec::with_capacity(params.sections.len());
    for (i, sec) in params.sections.iter().enumerate() {
        let wp = build_workplane(&sec.plane);
        let face = build_profile_face(&wp, &sec.profile)
            .with_context(|| format!("loft section {i}"))?;
        wires.push(face.outer_wire());
    }
    let solid: Solid = Solid::loft(wires.iter());
    let shape: Shape = solid.into();

    // Naming / orientation reference the FIRST section's plane.
    let p0 = &params.sections[0].plane;
    let plane_origin = dvec3(p0.origin[0], p0.origin[1], p0.origin[2]);
    let plane_normal = dvec3(p0.normal[0], p0.normal[1], p0.normal[2]);
    let topology = extract_topology(&shape);
    let faces_out =
        tessellate_and_name(&shape, plane_origin, plane_normal, 0.0, &params.feature_id, Some(&topology))?;
    let brep_bytes = serialize_brep(&shape);
    Ok(BuildExtrudeResult {
        brep_bytes: BASE64.encode(&brep_bytes),
        faces: faces_out,
        topology,
    })
}

/// Single-direction prism builder shared by direction 1 and direction 2.
/// Branches on holes the same way the original `build` did; pulled out
/// so direction 2 doesn't duplicate the logic. */
fn build_prism(
    workplane: &Workplane,
    profile: &[ProfileEdge],
    holes: &[Vec<ProfileEdge>],
    extrude_dir: glam::DVec3,
) -> Result<Shape> {
    if holes.is_empty() {
        let face = build_profile_face(workplane, profile)?;
        let solid: Solid = face.extrude(extrude_dir);
        Ok(solid.into())
    } else {
        let compound = build_compound_face_with_holes(workplane, profile, holes)?;
        Ok(compound.extrude(extrude_dir))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Workplane + profile construction
// ────────────────────────────────────────────────────────────────────────────

pub fn build_workplane(plane: &Plane3) -> Workplane {
    // Workplane::new(x_dir, normal_dir) — y_dir is implied as normal × x_dir
    // (right-handed). `set_translation` takes a world-space origin verbatim;
    // `translated()` (immutable variant) re-projects the offset through the
    // workplane's rotation first via `to_world_pos`, which is the wrong
    // semantics when the protocol gives us a world-space origin directly.
    let x = dvec3(plane.x_axis[0], plane.x_axis[1], plane.x_axis[2]);
    let n = dvec3(plane.normal[0], plane.normal[1], plane.normal[2]);
    let origin = dvec3(plane.origin[0], plane.origin[1], plane.origin[2]);
    let mut wp = Workplane::new(x, n);
    wp.set_translation(origin);
    wp
}

pub fn build_profile_face(workplane: &Workplane, profile: &[ProfileEdge]) -> Result<Face> {
    if profile.is_empty() {
        return Err(anyhow!("profile is empty"));
    }
    // Fast path — a single `circle` edge IS the loop (matches REQ 612 on the
    // frontend). The Wire returned by Workplane::circle is closed by
    // construction.
    if profile.len() == 1 {
        if let ProfileEdge::Circle { center, radius } = &profile[0] {
            let wire = workplane.circle(center.x, center.y, *radius);
            return Ok(Face::from_wire(&wire));
        }
    }

    // Reject mixed circles early — a circle must be the sole edge.
    for edge in profile {
        if let ProfileEdge::Circle { .. } = edge {
            return Err(anyhow!(
                "'circle' edge mixed into a polygon profile is invalid; circles must be the sole edge"
            ));
        }
    }

    // Glyph (text) profiles carry Bézier edges, which the 2D sketch DSL can't
    // express. Build those via OCCT `Edge::bezier` + `Wire::from_edges` so each
    // curve becomes ONE smooth face instead of N tessellated chords. Handled
    // BEFORE the chord-polygon validation below — those guards (min-3 verts,
    // collinear corners, zero-length edges) are tuned for straight-edge
    // profiles and would falsely reject valid glyph contours. Lines/arcs in a
    // bezier loop build uniformly there.
    if profile.iter().any(|e| matches!(e, ProfileEdge::Bezier { .. })) {
        return build_bezier_profile_face(workplane, profile);
    }

    // Orientation polygon (one vertex per edge start + each arc's midpoint) —
    // used only for the winding/area test and the validate_polygon guards; the
    // wire itself is built from the true edges below.
    let mut polygon = orientation_polygon(profile);
    if polygon.len() < 3 {
        return Err(anyhow!(
            "profile must have at least 3 edges to form a closed polygon \
             (or 2 with a curved edge), got {} vertices",
            polygon.len()
        ));
    }
    polygon = dedup_consecutive(polygon);
    if polygon.len() < 3 {
        return Err(anyhow!(
            "profile collapses to fewer than 3 distinct vertices after merging \
             coincident points — the sketch likely has overlapping geometry",
        ));
    }
    validate_polygon(&polygon)?;

    // OCCT wants a counter-clockwise wire for `face.extrude` to produce an
    // outward-pointing solid. The frontend's walker doesn't guarantee
    // orientation, so we reverse here if needed. For arcs the reversal
    // ALSO swaps start↔end and flips ccw so the arc is traversed in the
    // opposite rotational sense.
    let reverse = signed_polygon_area(&polygon) < 0.0;
    let edges: Vec<&ProfileEdge> = if reverse {
        profile.iter().rev().collect()
    } else {
        profile.iter().collect()
    };

    // Start point: first edge's start (or end if reversed).
    let first = edges[0];
    let (sx, sy) = traversal_start(first, reverse);
    info!("profile walk start ({:.4}, {:.4}), reverse={}, edges={}",
          sx, sy, reverse, edges.len());
    let mut sketch = workplane.sketch().move_to(sx, sy);
    // Track the running cursor in Rust so we can skip degenerate edges
    // (zero-length lines, arcs with start ≈ end) before they reach OCCT.
    // OCCT throws StdFail_NotDone from MakeEdge / MakeArcOfCircle for these
    // and the C++ exception escapes Rust as a SIGABRT, killing the kernel.
    // Upstream walkers can produce such edges when the sketch contains a
    // degenerate entity (e.g. a Line with startId == endId left from a
    // half-completed edit), and a defensive skip here is cheaper than
    // hardening every upstream walker.
    let mut cursor = (sx, sy);
    const MIN_EDGE_LEN_SQ: f64 = 1.0e-10;

    for (i, edge) in edges.iter().enumerate() {
        match **edge {
            ProfileEdge::Line { start, end } => {
                let (ex, ey) = if reverse { (start.x, start.y) } else { (end.x, end.y) };
                let dx = ex - cursor.0;
                let dy = ey - cursor.1;
                if dx * dx + dy * dy < MIN_EDGE_LEN_SQ {
                    warn!("  edge {}: skipping zero-length line at ({:.4}, {:.4})", i, ex, ey);
                    continue;
                }
                info!("  edge {}: line_to ({:.4}, {:.4})", i, ex, ey);
                sketch = sketch.line_to(ex, ey);
                cursor = (ex, ey);
            }
            ProfileEdge::Arc { center, radius, start_angle, end_angle, ccw, start, end } => {
                // After reversal, swap start↔end and flip ccw. The arc's
                // rotational sense is preserved by inverting both, which
                // keeps the geometry identical but traverses it the other
                // way around.
                let (sa, ea, sweep_ccw, sx_a, sy_a, ex, ey) = if reverse {
                    (end_angle, start_angle, !ccw, end.x, end.y, start.x, start.y)
                } else {
                    (start_angle, end_angle, ccw, start.x, start.y, end.x, end.y)
                };
                let dx = ex - cursor.0;
                let dy = ey - cursor.1;
                if dx * dx + dy * dy < MIN_EDGE_LEN_SQ {
                    warn!("  edge {}: skipping zero-length arc (start ≈ end)", i);
                    continue;
                }
                // Sweep angle in the traversal's rotational sense, normalised
                // to (0, 2π] for CCW or [-2π, 0) for CW.
                let mut sweep = ea - sa;
                if sweep_ccw {
                    while sweep <= 0.0 { sweep += std::f64::consts::TAU; }
                } else {
                    while sweep >= 0.0 { sweep -= std::f64::consts::TAU; }
                }
                let mid_angle = sa + sweep / 2.0;
                let mid_x = center.x + radius * mid_angle.cos();
                let mid_y = center.y + radius * mid_angle.sin();
                info!(
                    "  edge {}: three_point_arc start=({:.4}, {:.4}) mid=({:.4}, {:.4}) end=({:.4}, {:.4}) \
                     center=({:.4}, {:.4}) r={:.4} sa={:.4} ea={:.4} ccw={} sweep={:.4}",
                    i, sx_a, sy_a, mid_x, mid_y, ex, ey,
                    center.x, center.y, radius, sa, ea, sweep_ccw, sweep,
                );
                sketch = sketch.three_point_arc((mid_x, mid_y), (ex, ey));
                cursor = (ex, ey);
            }
            // Profiles containing Bézier edges are built by the Edge/Wire path
            // above (early return), so the 2D sketch DSL never sees one.
            ProfileEdge::Bezier { .. } => unreachable!("bezier profiles use the Edge/Wire path"),
            ProfileEdge::Circle { .. } => unreachable!("rejected above"),
        }
    }

    // Each edge in the walk ends at the next edge's start, and the final
    // edge ends at the loop's start point — so cursor == first_point and
    // `wire()` collects the closed chain. `close()` would add a tautological
    // zero-length segment that OCCT rejects.
    let wire = sketch.wire();
    Ok(Face::from_wire(&wire))
}

/// Build a planar face for a profile containing Bézier edges (text glyphs).
/// Each curve becomes one smooth OCCT edge via `Edge::bezier`, so a letter is
/// a handful of faces instead of hundreds of tessellated chords. Orientation
/// comes from the concatenated control-point polygon (its signed-area sign
/// matches the curve loop's); the chord-polygon validation in
/// `build_profile_face` is intentionally skipped — glyph contours legitimately
/// contain short or collinear segments those guards would reject.
fn build_bezier_profile_face(workplane: &Workplane, profile: &[ProfileEdge]) -> Result<Face> {
    const MIN_EDGE_LEN_SQ: f64 = 1.0e-10;

    // Orientation from every control point in loop order.
    let mut orient: Vec<(f64, f64)> = Vec::new();
    for e in profile {
        match e {
            ProfileEdge::Line { start, .. } => orient.push((start.x, start.y)),
            ProfileEdge::Arc { start, .. } => orient.push((start.x, start.y)),
            ProfileEdge::Bezier { points } => {
                for p in points {
                    orient.push((p.x, p.y));
                }
            }
            ProfileEdge::Circle { .. } => unreachable!("circles rejected above"),
        }
    }
    let reverse = signed_polygon_area(&orient) < 0.0;
    let ordered: Vec<&ProfileEdge> = if reverse {
        profile.iter().rev().collect()
    } else {
        profile.iter().collect()
    };

    // Map a 2D workplane point onto the plane in world space. `Workplane`
    // doesn't expose `transform_point`, so compose it from the basis accessors:
    // world = origin + x_dir·x + y_dir·y.
    let wp_origin = workplane.origin();
    let wp_x = workplane.x_dir();
    let wp_y = workplane.y_dir();
    let to_world = |x: f64, y: f64| wp_origin + wp_x * x + wp_y * y;
    let mut occ_edges: Vec<Edge> = Vec::new();
    let mut cursor = traversal_start(ordered[0], reverse);
    for edge in &ordered {
        match **edge {
            ProfileEdge::Line { start, end } => {
                let (ex, ey) = if reverse { (start.x, start.y) } else { (end.x, end.y) };
                if (ex - cursor.0).powi(2) + (ey - cursor.1).powi(2) < MIN_EDGE_LEN_SQ {
                    continue;
                }
                occ_edges.push(Edge::segment(to_world(cursor.0, cursor.1), to_world(ex, ey)));
                cursor = (ex, ey);
            }
            ProfileEdge::Arc { center, radius, start_angle, end_angle, ccw, start, end } => {
                let (sa, ea, sweep_ccw, ex, ey) = if reverse {
                    (end_angle, start_angle, !ccw, start.x, start.y)
                } else {
                    (start_angle, end_angle, ccw, end.x, end.y)
                };
                if (ex - cursor.0).powi(2) + (ey - cursor.1).powi(2) < MIN_EDGE_LEN_SQ {
                    continue;
                }
                let mut sweep = ea - sa;
                if sweep_ccw {
                    while sweep <= 0.0 { sweep += std::f64::consts::TAU; }
                } else {
                    while sweep >= 0.0 { sweep -= std::f64::consts::TAU; }
                }
                let mid_angle = sa + sweep / 2.0;
                let mid_x = center.x + radius * mid_angle.cos();
                let mid_y = center.y + radius * mid_angle.sin();
                occ_edges.push(Edge::arc(
                    to_world(cursor.0, cursor.1),
                    to_world(mid_x, mid_y),
                    to_world(ex, ey),
                ));
                cursor = (ex, ey);
            }
            ProfileEdge::Bezier { ref points } => {
                if points.len() < 2 {
                    continue;
                }
                let raw: Vec<DVec3> = if reverse {
                    points.iter().rev().map(|p| to_world(p.x, p.y)).collect()
                } else {
                    points.iter().map(|p| to_world(p.x, p.y)).collect()
                };
                // Drop coincident consecutive control points (repeated poles).
                // A repeated pole makes a cusped/degenerate Bézier whose
                // linear-extrusion side surface BRepMesh fails to mesh — the
                // most common "BRepMesh failed on a face" for glyph profiles.
                let mut ctrl: Vec<DVec3> = Vec::with_capacity(raw.len());
                for p in raw {
                    if ctrl.last().map_or(true, |q: &DVec3| (p - *q).length_squared() > MIN_EDGE_LEN_SQ) {
                        ctrl.push(p);
                    }
                }
                let endp = if reverse { &points[0] } else { &points[points.len() - 1] };
                // Collapsed to a point → skip entirely (cursor unchanged, since
                // a degenerate segment has coincident endpoints anyway).
                if ctrl.len() >= 2 {
                    occ_edges.push(Edge::bezier(ctrl));
                }
                cursor = (endp.x, endp.y);
            }
            ProfileEdge::Circle { .. } => unreachable!("circles rejected above"),
        }
    }
    if occ_edges.len() < 2 {
        return Err(anyhow!(
            "text/bezier profile produced too few edges ({})",
            occ_edges.len()
        ));
    }
    let wire = Wire::from_edges(&occ_edges);
    Ok(Face::from_wire(&wire))
}

/// Build a planar face with holes (CompoundFace) by subtracting each
/// hole's face from the outer face one at a time. Each iteration takes
/// the running CompoundFace ⊖ the next hole (promoted Face → CompoundFace
/// via `From<Face>`). Used for donut-style regions from
/// `extractRegions` where the outer loop has one or more inner loops.
pub fn build_compound_face_with_holes(
    workplane: &Workplane,
    outer: &[ProfileEdge],
    holes: &[Vec<ProfileEdge>],
) -> Result<CompoundFace> {
    let outer_face = build_profile_face(workplane, outer)
        .context("building outer face of region")?;
    let mut acc: CompoundFace = outer_face.into();
    for (i, hole_edges) in holes.iter().enumerate() {
        let hole_face = build_profile_face(workplane, hole_edges)
            .with_context(|| format!("building hole face {}", i))?;
        let hole_compound: CompoundFace = hole_face.into();
        acc = acc.subtract(&hole_compound);
    }
    Ok(acc)
}

/// Start point for the loop walk, accounting for the reversal flag — the
/// "start" of the first edge in the traversal is its `start` field normally,
/// or its `end` field when the profile is being walked in reverse.
fn traversal_start(edge: &ProfileEdge, reverse: bool) -> (f64, f64) {
    match edge {
        ProfileEdge::Line { start, end } |
        ProfileEdge::Arc  { start, end, .. } => {
            if reverse { (end.x, end.y) } else { (start.x, start.y) }
        }
        ProfileEdge::Bezier { points } => {
            let p = if reverse { points.last() } else { points.first() };
            let p = p.expect("bezier edge has no control points");
            (p.x, p.y)
        }
        ProfileEdge::Circle { .. } => unreachable!(),
    }
}

/// Reject profiles OCCT can't build a wire from. Each branch maps to a
/// known way `BRepBuilderAPI_MakeWire` throws `StdFail_NotDone`:
///   - Zero-length edges (consecutive coincident vertices) → MakeEdge fails.
///   - Three consecutive collinear vertices → degenerate Y-junction; some
///     OCCT versions throw, others produce a malformed wire.
///   - Below-threshold total area → degenerate face; extrude throws.
const MIN_VERTEX_DIST_SQ: f64 = 1.0e-8;   // ~1e-4 units between points
const MIN_POLY_AREA: f64 = 1.0e-6;        // 1e-3 × 1e-3 — way below any
                                          // realistic CAD sketch
const COLLINEAR_TOL: f64 = 1.0e-9;        // |cross product| threshold

fn validate_polygon(points: &[(f64, f64)]) -> Result<()> {
    let n = points.len();
    for i in 0..n {
        let (ax, ay) = points[i];
        let (bx, by) = points[(i + 1) % n];
        let dx = bx - ax;
        let dy = by - ay;
        if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ {
            return Err(anyhow!(
                "profile has a zero-length edge between vertices {} and {} — \
                 consecutive points coincide (likely a near-degenerate polygon)",
                i, (i + 1) % n,
            ));
        }
    }
    // Collinear-triple check is a soft warning: many valid CAD profiles have
    // colinear points where two segments meet without a corner (e.g. a slot's
    // straight side adjoining a cap). We only flag the case where THREE
    // consecutive vertices are exactly collinear AND the middle one is
    // between the two others — that's a degenerate corner.
    for i in 0..n {
        let a = points[i];
        let b = points[(i + 1) % n];
        let c = points[(i + 2) % n];
        let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        if cross.abs() > COLLINEAR_TOL { continue; }
        // Same-line; check if b is between a and c.
        let dot = (b.0 - a.0) * (c.0 - a.0) + (b.1 - a.1) * (c.1 - a.1);
        let ac_len_sq = (c.0 - a.0).powi(2) + (c.1 - a.1).powi(2);
        if dot > 0.0 && dot < ac_len_sq {
            return Err(anyhow!(
                "profile has a degenerate corner at vertex {} — three \
                 consecutive points are collinear with the middle one on the \
                 segment", (i + 1) % n,
            ));
        }
    }
    let area = signed_polygon_area(points).abs();
    if area < MIN_POLY_AREA {
        return Err(anyhow!(
            "profile encloses near-zero area ({}); pick distinct vertices", area,
        ));
    }
    Ok(())
}

/// Drop any vertex that sits within `MIN_VERTEX_DIST_SQ` of its predecessor
/// (and the wrap-around case where the last vertex sits on the first). This
/// makes the kernel robust to upstream walkers that emit duplicate vertices.
fn dedup_consecutive(points: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    if points.is_empty() { return points; }
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for p in points {
        if let Some(&last) = out.last() {
            let dx = p.0 - last.0;
            let dy = p.1 - last.1;
            if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ { continue; }
        }
        out.push(p);
    }
    // Wrap-around: if the last point coincides with the first (the would-be
    // closing edge is zero-length), drop the last.
    while out.len() > 1 {
        let first = out[0];
        let last = *out.last().unwrap();
        let dx = last.0 - first.0;
        let dy = last.1 - first.1;
        if dx * dx + dy * dy < MIN_VERTEX_DIST_SQ { out.pop(); } else { break; }
    }
    out
}

/// Orientation polygon for a profile loop: one vertex per edge start, PLUS each
/// arc's midpoint. Used only for the winding/area test and the validate_polygon
/// defensive guards — the wire is built from the true edges, arcs included.
///
/// The arc midpoint matters for two reasons: (1) it makes a 2-edge loop with a
/// curved side — a semicircle arc + its diameter line (a D-shape), or two arcs
/// forming a lens — yield ≥3 vertices and a non-zero area, so it clears the
/// "≥3 vertices" guard instead of collapsing to a degenerate 2-point chord;
/// (2) it captures the arc's bulge so the signed area faithfully reflects the
/// loop's winding. Two straight lines between the same endpoints still collapse
/// to 2 vertices (zero area) and are correctly rejected. A real arc's midpoint
/// sits far enough off its chord that the collinear guard (COLLINEAR_TOL = 1e-9)
/// never trips, so filleted/slotted profiles are unaffected.
fn orientation_polygon(profile: &[ProfileEdge]) -> Vec<(f64, f64)> {
    let mut polygon: Vec<(f64, f64)> = Vec::with_capacity(profile.len() * 2);
    for e in profile {
        match e {
            ProfileEdge::Line { start, .. } => polygon.push((start.x, start.y)),
            ProfileEdge::Arc { start, center, radius, start_angle, end_angle, ccw, .. } => {
                polygon.push((start.x, start.y));
                // Midpoint angle in the arc's own rotational sense (matches the
                // sweep normalisation used by the edge walk in build_profile_face).
                let mut sweep = end_angle - start_angle;
                if *ccw {
                    while sweep <= 0.0 { sweep += std::f64::consts::TAU; }
                } else {
                    while sweep >= 0.0 { sweep -= std::f64::consts::TAU; }
                }
                let mid = start_angle + sweep / 2.0;
                polygon.push((center.x + radius * mid.cos(), center.y + radius * mid.sin()));
            }
            ProfileEdge::Bezier { points } => polygon.push((points[0].x, points[0].y)),
            ProfileEdge::Circle { .. } => {} // a lone circle never reaches here (len==1 fast path)
        }
    }
    polygon
}

/// Shoelace formula. Positive == CCW, negative == CW. Zero for degenerate.
fn signed_polygon_area(points: &[(f64, f64)]) -> f64 {
    let n = points.len();
    let mut sum = 0.0_f64;
    for i in 0..n {
        let (x1, y1) = points[i];
        let (x2, y2) = points[(i + 1) % n];
        sum += x1 * y2 - x2 * y1;
    }
    sum / 2.0
}

// ────────────────────────────────────────────────────────────────────────────
// Per-face tessellation + persistent naming
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
enum FaceKind { CapBottom, CapTop, Side }

fn tessellate_and_name(
    shape: &Shape,
    plane_origin: DVec3,
    plane_normal: DVec3,
    signed_distance: f64,
    feature_id: &str,
    topology: Option<&Topology>,
) -> Result<Vec<FaceMesh>> {
    // Pre-pass: classify each OCCT face by where its centroid sits along the
    // normal axis. Cap-bottom = axial ≈ 0; cap-top = axial ≈ signed_distance;
    // everything else = side.
    let tol = (signed_distance.abs() * 1e-3).max(1e-6);

    let mut classified: Vec<(FaceKind, Face, f64, f64)> = Vec::new();
    for face in shape.faces() {
        let centroid = face.center_of_mass();
        let offset = centroid - plane_origin;
        let axial = offset.dot(plane_normal);
        let kind = if (axial - 0.0).abs() <= tol {
            FaceKind::CapBottom
        } else if (axial - signed_distance).abs() <= tol {
            FaceKind::CapTop
        } else {
            FaceKind::Side
        };
        // Angular sort key for side faces — keeps side `0` consistent across
        // regens (otherwise face enumeration order would be OCCT-internal
        // and could rearrange under harmless edits).
        let in_plane = offset - plane_normal * axial;
        let angle = in_plane.z.atan2(in_plane.x);
        classified.push((kind, face, axial, angle));
    }
    classified.sort_by(|a, b| {
        let order_a = match a.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        let order_b = match b.0 { FaceKind::CapBottom => 0, FaceKind::Side => 1, FaceKind::CapTop => 2 };
        order_a.cmp(&order_b).then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    // Pre-build edge_id_by_key from topology so each face's boundary
    // can be resolved without centroid-match guessing. The OCCT face is
    // right here in the loop, so this is exact: face.edges() → key →
    // topology edge id.
    let id_by_key: std::collections::HashMap<[[i64; 3]; 3], String> = topology
        .map(|t| {
            t.edges.iter().map(|e| {
                fn quantize(v: [f64; 3]) -> [i64; 3] {
                    const STEP: f64 = 1.0e6;
                    [(v[0] * STEP).round() as i64, (v[1] * STEP).round() as i64, (v[2] * STEP).round() as i64]
                }
                let start = quantize(e.endpoints[0]);
                let end = quantize(e.endpoints[1]);
                let (lo, hi) = if start <= end { (start, end) } else { (end, start) };
                let mid = if let Some(poly) = &e.polyline {
                    if poly.len() >= 3 { quantize(poly[poly.len() / 2]) } else { lo }
                } else {
                    lo
                };
                ([lo, mid, hi], e.id.clone())
            }).collect()
        })
        .unwrap_or_default();

    let mut side_index = 0_u32;
    let mut out = Vec::with_capacity(classified.len());
    for (kind, face, _axial, _angle) in classified {
        let face_shape: Shape = (&face).into();
        let mesh = face_shape
            .mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE)
            .context("BRepMesh failed on a face")?;
        let (positions, normals, indices) = flatten_mesh(&mesh);
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
        let mut boundary_edge_ids: Vec<String> = if id_by_key.is_empty() {
            Vec::new()
        } else {
            face.edges()
                .filter_map(|e| id_by_key.get(&crate::ops::shape_io::edge_geom_key(&e)).cloned())
                .collect()
        };
        boundary_edge_ids.sort();
        boundary_edge_ids.dedup();
        let surface = crate::ops::shape_io::classify_face_surface(&face);
        out.push(FaceMesh {
            face_id: id.clone(),
            persistent_name: id,
            is_flat,
            positions,
            normals,
            indices,
            boundary_edge_ids,
            surface,
        });
    }
    Ok(out)
}

/// Convert opencascade-rs's `Mesh` (DVec3 vertices + normals, usize indices)
/// into the three flat f32/u32 arrays the frontend renders. Normals come
/// straight from OCCT's `Poly_Triangulation_Normal` so we don't have to
/// recompute them.
fn flatten_mesh(mesh: &opencascade::mesh::Mesh) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let mut positions = Vec::with_capacity(mesh.vertices.len() * 3);
    for v in &mesh.vertices {
        positions.push(v.x as f32);
        positions.push(v.y as f32);
        positions.push(v.z as f32);
    }
    let mut normals = Vec::with_capacity(mesh.normals.len() * 3);
    for n in &mesh.normals {
        normals.push(n.x as f32);
        normals.push(n.y as f32);
        normals.push(n.z as f32);
    }
    // If OCCT's normals slice is shorter than vertices (it sometimes lags by
    // one due to opencascade-rs's `1..(length as usize)` loop — see the
    // `TODO(bschwind) - Why do we start at 1 here?` comment in mesh.rs),
    // pad with zeros so positions/normals stay aligned.
    while normals.len() < positions.len() {
        normals.push(0.0);
    }
    let indices: Vec<u32> = mesh.indices.iter().map(|&i| i as u32).collect();
    (positions, normals, indices)
}

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

// ────────────────────────────────────────────────────────────────────────────
// Topology + BREP
// ────────────────────────────────────────────────────────────────────────────

fn extract_topology(shape: &Shape) -> Topology {
    // opencascade-rs exposes shape.edges() (not shape.vertices()). Derive
    // vertex positions from each edge's start + end points and dedupe. This
    // is enough for Phase 0; Phase 1 will add persistent edge naming + curve
    // type metadata (line vs arc vs spline) once the per-feature graph
    // tracks dependencies on specific edges.
    let mut vertices: Vec<TopologyVertex> = Vec::new();
    let mut edges: Vec<TopologyEdge> = Vec::new();
    let mut seen_v: std::collections::HashSet<[i64; 3]> = std::collections::HashSet::new();
    let mut v_id_counter = 0usize;

    fn quantize(v: DVec3) -> [i64; 3] {
        // 1e-6 quantization step — enough to dedupe shared endpoints without
        // collapsing distinct vertices in normal-sized models.
        const STEP: f64 = 1.0e6;
        [(v.x * STEP).round() as i64, (v.y * STEP).round() as i64, (v.z * STEP).round() as i64]
    }

    // Tangent-edge detection: see shape_io::detect_tangent_edges for the
    // rationale. Seam-class entries get dropped entirely; Tangent-class
    // entries remain in topology but flagged so the viewer dashes them.
    let classified = crate::ops::shape_io::detect_tangent_edges_pub(shape);

    for (e_idx, edge) in shape.edges().enumerate() {
        let start = edge.start_point();
        let end = edge.end_point();
        let key = crate::ops::shape_io::edge_geom_key(&edge);
        let kind = classified.get(&key).copied();
        if matches!(kind, Some(crate::ops::shape_io::TangentKind::Seam)) {
            continue;
        }
        for p in [start, end] {
            let vkey = quantize(p);
            if seen_v.insert(vkey) {
                vertices.push(TopologyVertex {
                    id: format!("v{}", v_id_counter),
                    position: [p.x, p.y, p.z],
                });
                v_id_counter += 1;
            }
        }
        let is_tangent = matches!(kind, Some(crate::ops::shape_io::TangentKind::Tangent));
        let (is_straight, polyline) = crate::ops::shape_io::sample_edge_curve(&edge);
        edges.push(TopologyEdge {
            id: format!("e{}", e_idx),
            is_straight,
            is_tangent,
            endpoints: [[start.x, start.y, start.z], [end.x, end.y, end.z]],
            polyline,
        });
    }
    Topology { vertices, edges }
}

fn serialize_brep(shape: &Shape) -> Vec<u8> {
    // opencascade-rs exposes write_brep_text/_bin only on paths. For Phase 0
    // we round-trip through a temp file; Phase 1 either upstreams an
    // in-memory writer or drops to opencascade-sys directly. The text form
    // is what Phase 1's BinTools swap will replace.
    let tmp = std::env::temp_dir().join(format!(
        "letwinventory-cad-kernel-{}.brep",
        std::process::id()
    ));
    if let Err(e) = shape.write_brep_text(&tmp).context("write BREP to temp file") {
        warn!(error = ?e, "BREP serialization unavailable (Phase 1 fixes this)");
        return Vec::new();
    }
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_drops_consecutive_coincident_points() {
        let input = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let out = dedup_consecutive(input);
        assert_eq!(out, vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    }

    #[test]
    fn dedup_drops_wrap_around_duplicate() {
        // Last vertex sits on top of the first → closing edge would be 0-length.
        let input = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)];
        let out = dedup_consecutive(input);
        assert_eq!(out, vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    }

    #[test]
    fn shoelace_is_positive_for_ccw_unit_square() {
        let ccw = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        assert!(signed_polygon_area(&ccw) > 0.0);
    }

    #[test]
    fn shoelace_is_negative_for_cw_unit_square() {
        let cw = vec![(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)];
        assert!(signed_polygon_area(&cw) < 0.0);
    }

    #[test]
    fn validate_rejects_zero_length_edge() {
        let bad = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 0.0), (0.0, 1.0)];
        assert!(validate_polygon(&bad).is_err());
    }

    #[test]
    fn validate_accepts_ccw_rectangle() {
        let ok = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)];
        assert!(validate_polygon(&ok).is_ok());
    }

    fn pt(x: f64, y: f64) -> Point2 { Point2 { x, y } }

    #[test]
    fn orientation_polygon_adds_arc_midpoint_for_semicircle_plus_line() {
        use std::f64::consts::PI;
        // Semicircle arc over the top from (10,0) ccw to (-10,0), closed by the
        // diameter line back to (10,0). Two edges — but a real closed region.
        let profile = vec![
            ProfileEdge::Arc {
                center: pt(0.0, 0.0), radius: 10.0,
                start_angle: 0.0, end_angle: PI, ccw: true,
                start: pt(10.0, 0.0), end: pt(-10.0, 0.0),
            },
            ProfileEdge::Line { start: pt(-10.0, 0.0), end: pt(10.0, 0.0) },
        ];
        let poly = orientation_polygon(&profile);
        // arc.start + arc.mid + line.start = 3 vertices, midpoint at the top.
        assert_eq!(poly.len(), 3);
        assert!((poly[1].0 - 0.0).abs() < 1e-9 && (poly[1].1 - 10.0).abs() < 1e-9);
        assert!(signed_polygon_area(&poly).abs() > MIN_POLY_AREA);
        assert!(validate_polygon(&poly).is_ok());
    }

    #[test]
    fn orientation_polygon_two_arcs_form_a_lens() {
        // Two arcs sharing endpoints (-6,0) and (6,0), bulging opposite ways
        // (centers at (0,∓8), r=10). Angles computed from the geometry so the
        // start field and start_angle agree; midpoints land at (0,±2).
        let r = 10.0_f64;
        // Upper lobe: center (0,-8); P1=(-6,0) at atan2(8,-6), P2=(6,0) at atan2(8,6).
        let a_s = (8.0_f64).atan2(-6.0);
        let a_e = (8.0_f64).atan2(6.0);
        // Lower lobe: center (0,8); P2=(6,0) at atan2(-8,6), P1=(-6,0) at atan2(-8,-6).
        let b_s = (-8.0_f64).atan2(6.0);
        let b_e = (-8.0_f64).atan2(-6.0);
        let profile = vec![
            ProfileEdge::Arc {
                center: pt(0.0, -8.0), radius: r,
                start_angle: a_s, end_angle: a_e, ccw: false,
                start: pt(-6.0, 0.0), end: pt(6.0, 0.0),
            },
            ProfileEdge::Arc {
                center: pt(0.0, 8.0), radius: r,
                start_angle: b_s, end_angle: b_e, ccw: false,
                start: pt(6.0, 0.0), end: pt(-6.0, 0.0),
            },
        ];
        let poly = orientation_polygon(&profile);
        // Each arc contributes start + midpoint = 4 vertices (a diamond).
        assert_eq!(poly.len(), 4);
        assert!((poly[1].0).abs() < 1e-9 && (poly[1].1 - 2.0).abs() < 1e-9);
        assert!((poly[3].0).abs() < 1e-9 && (poly[3].1 + 2.0).abs() < 1e-9);
        assert!(validate_polygon(&poly).is_ok());
    }

    #[test]
    fn orientation_polygon_two_straight_lines_stay_degenerate() {
        // Two lines retracing the same edge enclose zero area — must stay at 2
        // vertices so build_profile_face's "< 3" guard rejects them.
        let profile = vec![
            ProfileEdge::Line { start: pt(0.0, 0.0), end: pt(10.0, 0.0) },
            ProfileEdge::Line { start: pt(10.0, 0.0), end: pt(0.0, 0.0) },
        ];
        assert_eq!(orientation_polygon(&profile).len(), 2);
    }
}
