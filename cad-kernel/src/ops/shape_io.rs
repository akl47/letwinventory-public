//! Shared helpers for BRep serialize/deserialize and generic face
//! tessellation. Pulled out of `ops::extrude` so booleans and future
//! ops can reuse the round-trip without duplicating the temp-file dance.
//!
//! BRep round-trip is via temp file because opencascade-rs exposes
//! `write_brep_text` / `read_brep_text` only on `Path`. The phase-1
//! upgrade to OCCT's `BinTools` in-memory streams is tracked as future
//! work.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use glam::DVec3;
use opencascade::primitives::{Face, FaceSurface, Shape};

use crate::naming::PersistentName;
use crate::protocol::{FaceMesh, FaceSurface as ProtoFaceSurface, SolidPart, Topology, TopologyEdge, TopologyVertex};

const DEFAULT_CHORD_TOLERANCE: f64 = 0.05;

/// Per-call counter so concurrent kernel requests don't clobber each
/// other's temp files. PID-only collided when two RPCs raced on the
/// same socket connection.
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_brep_path(tag: &str) -> PathBuf {
    let n = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "letwinventory-cad-kernel-{}-{}-{}.brep",
        std::process::id(),
        tag,
        n,
    ))
}

/// Serialize a Shape to BREP text bytes. Returns an empty Vec if OCCT
/// fails — the caller decides whether that's acceptable.
pub fn serialize_brep(shape: &Shape) -> Vec<u8> {
    let tmp = temp_brep_path("out");
    if shape.write_brep_text(&tmp).is_err() {
        return Vec::new();
    }
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    bytes
}

/// Decode a base64-encoded BREP text payload and read it back as a Shape.
pub fn deserialize_brep_from_base64(b64: &str) -> Result<Shape> {
    let bytes = BASE64.decode(b64).context("decode base64 BREP payload")?;
    let tmp = temp_brep_path("in");
    std::fs::write(&tmp, &bytes).context("write BREP to temp file for deserialize")?;
    let shape = Shape::read_brep_text(&tmp).map_err(|e| anyhow!("read BREP: {e:?}"))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(shape)
}

/// Encode raw BREP bytes as base64 for transit over JSON-RPC.
pub fn brep_to_base64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// Tessellate every face of a shape with deterministic face IDs derived
/// from a centroid-lexicographic sort. Used for boolean / cut results
/// where the extrude-specific cap/side classification doesn't apply.
/// IDs stay stable under small parameter tweaks because OCCT's face
/// centroids move continuously with their parameters; only topology
/// changes (a face appears / disappears) reshuffle the order.
pub fn tessellate_faces_generic(shape: &Shape, feature_id: &str) -> Result<Vec<FaceMesh>> {
    tessellate_faces_generic_with_topology(shape, feature_id, None)
}

/// Same as `tessellate_faces_generic`, but optionally populates each
/// `FaceMesh.boundary_edge_ids` inline using a pre-computed topology.
/// Callers that need face↔edge adjacency should pass `Some(&topology)`;
/// the lookup runs on the OCCT face directly so there's no centroid
/// match approximation (which was getting fooled by concentric/symmetric
/// faces sharing centroids).
pub fn tessellate_faces_generic_with_topology(
    shape: &Shape,
    feature_id: &str,
    topology: Option<&Topology>,
) -> Result<Vec<FaceMesh>> {
    // Pre-build edge_id_by_key from topology so each face can look up
    // its boundary edges by key match — same key shape as edge_geom_key.
    let id_by_key: std::collections::HashMap<[[i64; 3]; 3], String> = topology
        .map(|t| t.edges.iter().map(|e| (topology_edge_key(e), e.id.clone())).collect())
        .unwrap_or_default();

    let mut faces: Vec<(f64, f64, f64, opencascade::primitives::Face)> = shape
        .faces()
        .map(|f| {
            let c = f.center_of_mass();
            (c.x, c.y, c.z, f)
        })
        .collect();
    faces.sort_by(|a, b| {
        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut out = Vec::with_capacity(faces.len());
    for (i, (cx, cy, cz, face)) in faces.into_iter().enumerate() {
        let face_shape: Shape = (&face).into();
        let edge_count = face.edges().count();
        let mesh = face_shape
            .mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE)
            .with_context(|| format!(
                "BRepMesh failed on face {} (centroid ({:.3}, {:.3}, {:.3}), {} edges)",
                i, cx, cy, cz, edge_count,
            ))?;
        let (positions, normals, indices) = flatten_mesh(&mesh);
        let persistent = PersistentName::side(feature_id, i as u32);
        let id = persistent.encode();
        let mut boundary_edge_ids: Vec<String> = if id_by_key.is_empty() {
            Vec::new()
        } else {
            face.edges()
                .filter_map(|e| id_by_key.get(&edge_geom_key(&e)).cloned())
                .collect()
        };
        boundary_edge_ids.sort();
        boundary_edge_ids.dedup();
        tracing::info!(
            face_idx = i,
            face_id = %id,
            centroid = format!("({:.3}, {:.3}, {:.3})", cx, cy, cz),
            boundary_edge_count = boundary_edge_ids.len(),
            boundary_edges = format!("{:?}", boundary_edge_ids),
            "tessellate_faces_generic: face → boundary",
        );
        let surface = classify_face_surface(&face);
        out.push(FaceMesh {
            face_id: id.clone(),
            persistent_name: id,
            is_flat: looks_flat(&normals),
            positions,
            normals,
            indices,
            boundary_edge_ids,
            surface,
        });
    }
    Ok(out)
}

/// Map a face's analytic surface classification (REQ 749) into the wire protocol
/// shape consumed by the assembly mate solver. Returns None for surfaces that are
/// neither planar nor cylindrical. Shared by the generic and extrude tessellators.
pub fn classify_face_surface(face: &Face) -> Option<ProtoFaceSurface> {
    match face.surface_kind()? {
        FaceSurface::Plane { origin, normal } => Some(ProtoFaceSurface {
            kind: "plane".to_string(),
            origin: [origin.x, origin.y, origin.z],
            normal: Some([normal.x, normal.y, normal.z]),
            axis: None,
            radius: None,
        }),
        FaceSurface::Cylinder { origin, axis, radius } => Some(ProtoFaceSurface {
            kind: "cylinder".to_string(),
            origin: [origin.x, origin.y, origin.z],
            normal: None,
            axis: Some([axis.x, axis.y, axis.z]),
            radius: Some(radius),
        }),
    }
}

/// Reconstruct the same key `edge_geom_key` produces, from a serialized
/// topology edge. Used to pre-build the key→id lookup table so faces
/// can resolve their boundary edges in one O(1) pass per face edge.
fn topology_edge_key(edge: &TopologyEdge) -> [[i64; 3]; 3] {
    fn quantize(v: [f64; 3]) -> [i64; 3] {
        const STEP: f64 = 1.0e6;
        [(v[0] * STEP).round() as i64, (v[1] * STEP).round() as i64, (v[2] * STEP).round() as i64]
    }
    let start = quantize(edge.endpoints[0]);
    let end = quantize(edge.endpoints[1]);
    let (lo, hi) = if start <= end { (start, end) } else { (end, start) };
    let mid = if let Some(poly) = &edge.polyline {
        if poly.len() >= 3 { quantize(poly[poly.len() / 2]) } else { lo }
    } else {
        lo
    };
    [lo, mid, hi]
}

/// Split a shape into its independent disjoint solids, returning one
/// `SolidPart` per solid. A boolean cut that physically severs a body
/// into two pieces produces a TopoDS_Compound containing two solids;
/// this helper enumerates them so the backend can treat each as a
/// separate body (SolidWorks-style body tracking).
///
/// Face IDs are namespaced per solid (`${feature_id}#bodyN#side_M`) so
/// the IDs stay unique across bodies. Face IDs from previous regens
/// where the same shape was treated as one body WILL NOT MATCH after a
/// split — that's expected; topology changes invalidate face references.
pub fn decompose_into_solids(shape: &Shape, feature_id: &str) -> Result<Vec<SolidPart>> {
    let mut parts: Vec<SolidPart> = Vec::new();
    for (i, solid) in shape.solids().enumerate() {
        let solid_shape: Shape = (&solid).into();
        let scope = format!("{}#body{}", feature_id, i);
        let topology = extract_topology(&solid_shape);
        let faces = tessellate_faces_generic_with_topology(&solid_shape, &scope, Some(&topology))?;
        let brep_bytes = serialize_brep(&solid_shape);
        let (volume, centroid) = solid_shape.volume_centroid();
        parts.push(SolidPart {
            brep_bytes: brep_to_base64(&brep_bytes),
            centroid: [centroid.x, centroid.y, centroid.z],
            volume,
            faces,
            topology,
        });
    }
    Ok(parts)
}

/// Extract vertex + edge topology from a shape with deduped vertex
/// positions. Same algorithm as `extrude::extract_topology` but lifted
/// out so booleans + future ops can reuse it. Seam edges (the parametric
/// wrap on closed surfaces like tori, cylinders, and spheres) are
/// detected and skipped — they're real edges in the BRep but represent
/// no geometric discontinuity, and rendering them paints visual
/// artifacts like the line around a torus's outer equator.
pub fn extract_topology(shape: &Shape) -> Topology {
    let mut vertices: Vec<TopologyVertex> = Vec::new();
    let mut edges: Vec<TopologyEdge> = Vec::new();
    let mut seen_v: std::collections::HashSet<[i64; 3]> = std::collections::HashSet::new();
    let mut v_id_counter = 0usize;

    fn quantize(v: DVec3) -> [i64; 3] {
        const STEP: f64 = 1.0e6;
        [(v.x * STEP).round() as i64, (v.y * STEP).round() as i64, (v.z * STEP).round() as i64]
    }

    let classified = detect_tangent_edges(shape);
    tracing::info!(classified_size = classified.len(), "extract_topology: tangent filter built");

    for (e_idx, edge) in shape.edges().enumerate() {
        let start = edge.start_point();
        let end = edge.end_point();
        let key = edge_geom_key(&edge);
        let kind = classified.get(&key).copied();
        // Seam edges are parametric artifacts (cylinder u-wrap, co-domain
        // face splits). Drop them entirely so they don't appear in the
        // viewer at all. Vertex extraction is also skipped — a seam's
        // endpoints are shared with real edges that contribute them.
        if matches!(kind, Some(TangentKind::Seam)) {
            tracing::info!(
                edge_index = e_idx,
                assigned_id = "DROPPED",
                kind = "seam",
                start = format!("({:.2}, {:.2}, {:.2})", start.x, start.y, start.z),
                end = format!("({:.2}, {:.2}, {:.2})", end.x, end.y, end.z),
                geom_key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
                "extract_topology: edge",
            );
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
        let is_tangent = matches!(kind, Some(TangentKind::Tangent));
        let (is_straight, polyline) = sample_edge_curve(&edge);
        tracing::info!(
            edge_index = e_idx,
            assigned_id = if is_tangent { "TANGENT" } else { "kept" },
            kind = if is_straight { "line" } else { "curve" },
            start = format!("({:.2}, {:.2}, {:.2})", start.x, start.y, start.z),
            end = format!("({:.2}, {:.2}, {:.2})", end.x, end.y, end.z),
            polyline_len = polyline.as_ref().map(|p| p.len()).unwrap_or(0),
            geom_key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
            "extract_topology: edge",
        );
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

/// Geometric key for an edge: the rounded start point, end point, and a
/// midpoint sample, sorted so the orientation doesn't matter (seam edges
/// appear FORWARD on one face traversal and REVERSED on the other; we
/// want the same key either way).
pub(crate) fn edge_geom_key(edge: &opencascade::primitives::Edge) -> [[i64; 3]; 3] {
    fn quantize(v: DVec3) -> [i64; 3] {
        const STEP: f64 = 1.0e6;
        [(v.x * STEP).round() as i64, (v.y * STEP).round() as i64, (v.z * STEP).round() as i64]
    }
    let start = quantize(edge.start_point());
    let end = quantize(edge.end_point());
    let (lo, hi) = if start <= end { (start, end) } else { (end, start) };
    // Midpoint sample disambiguates two distinct edges that happen to
    // share endpoints (e.g. semicircle vs straight chord between the
    // same two points). We pick the GEOMETRIC midpoint of the polyline
    // (middle index) rather than `nth(2)` because polylines are
    // produced in traversal order — face A may walk start→end while
    // face B walks end→start, so `nth(2)` picks DIFFERENT points and
    // gives the same physical edge two different keys, causing the
    // tangent-edge detector to see two single-owner entries instead
    // of one two-owner entry. The middle index is orientation-stable
    // (polyline reversed has same middle).
    let poly: Vec<DVec3> = edge.approximation_segments().collect();
    let mid = if poly.len() >= 3 {
        quantize(poly[poly.len() / 2])
    } else {
        lo
    };
    [lo, mid, hi]
}

/// Find every edge that is NOT a real geometric feature — i.e. the two
/// surfaces meeting at the edge have continuous tangent planes (parallel
/// normals at the edge midpoint). Catches:
///   - Parametric seams (single face, edge appears twice via the u/v
///     wrap). Same surface on both sides → normals trivially equal.
///   - Boolean-induced co-domain face splits (e.g. a torus that the
///     fuse op split along a great circle when `clean()` couldn't merge
///     the halves because their parameter ranges differ). Both halves
///     evaluate to the same analytic surface so their normals at the
///     shared edge agree.
///   - Wire seams where the same analytic curve is shared by two faces
///     sitting on a single tangent-continuous surface (rare but
///     possible after sweep / loft).
/// Real feature edges (cylinder top ring, cube corner, fillet end, etc.)
/// have normals that diverge sharply across the edge and stay in the
/// returned topology.
/// Classification of an edge by the tangent detector.
///   - Tangent: a real BRep edge between two distinct faces whose
///     tangent planes match across the edge (fillet ↔ flat face, etc.).
///     The viewer should still draw it (lighter / dashed) so the user
///     can pick it for downstream ops (e.g. selecting the fillet boundary
///     edge for another operation).
///   - Seam: a *topological artifact* — the same face wraps around and
///     traverses this edge from both sides (cylinder u=0/u=2π wrap), or
///     a co-domain face split whose two halves are literally the same
///     analytic surface. There's no physical feature here; the viewer
///     should not draw it at all.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum TangentKind {
    Tangent,
    Seam,
}

/// Public re-export wrapper so extrude::extract_topology (which lives in
/// a sibling module) can reuse the same tangent-edge classifier.
pub(crate) fn detect_tangent_edges_pub(
    shape: &Shape,
) -> std::collections::HashMap<[[i64; 3]; 3], TangentKind> {
    detect_tangent_edges(shape)
}

fn detect_tangent_edges(shape: &Shape) -> std::collections::HashMap<[[i64; 3]; 3], TangentKind> {
    use opencascade::primitives::Face;
    let faces: Vec<Face> = shape.faces().collect();
    // Per edge key: list of (face_index, count) for every face that
    // references this edge. Count > 1 indicates a seam on a single face.
    let mut edge_faces: std::collections::HashMap<[[i64; 3]; 3], Vec<(usize, usize)>> = std::collections::HashMap::new();
    for (i, face) in faces.iter().enumerate() {
        let mut local: std::collections::HashMap<[[i64; 3]; 3], usize> = std::collections::HashMap::new();
        for edge in face.edges() {
            *local.entry(edge_geom_key(&edge)).or_insert(0) += 1;
        }
        for (k, c) in local {
            edge_faces.entry(k).or_default().push((i, c));
        }
    }
    let mut classified: std::collections::HashMap<[[i64; 3]; 3], TangentKind> =
        std::collections::HashMap::new();
    for (key, owners) in &edge_faces {
        let mid = DVec3::new(
            key[1][0] as f64 / 1.0e6,
            key[1][1] as f64 / 1.0e6,
            key[1][2] as f64 / 1.0e6,
        );
        let owner_counts: Vec<usize> = owners.iter().map(|(_, c)| *c).collect();
        let owner_indices: Vec<usize> = owners.iter().map(|(i, _)| *i).collect();
        if owners.len() == 1 && owners[0].1 >= 2 {
            // Parametric seam — a SINGLE face's u/v wrap. No physical
            // feature here. Suppress entirely (Seam, not Tangent).
            classified.insert(*key, TangentKind::Seam);
            tracing::info!(
                key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
                owners = format!("{:?}", owner_indices),
                counts = format!("{:?}", owner_counts),
                verdict = "SEAM (single face, ≥2 refs) → drop",
                "detect_tangent_edges",
            );
            continue;
        }
        if owners.len() == 2 {
            // Threshold widened to cos(5°) ≈ 0.9962 to catch boolean-induced
            // co-domain face splits whose normals drift a hair from the
            // parametric ideal. Real BRep edge between two faces, so it's
            // Tangent (visible-but-dashed), not Seam.
            let n0 = faces[owners[0].0].normal_at(mid);
            let n1 = faces[owners[1].0].normal_at(mid);
            let l0 = n0.length(); let l1 = n1.length();
            let dot = if l0 > 1.0e-9 && l1 > 1.0e-9 { n0.dot(n1) / (l0 * l1) } else { f64::NAN };
            let is_tangent = dot.abs() > 0.9962;
            if is_tangent { classified.insert(*key, TangentKind::Tangent); }
            tracing::info!(
                key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
                owners = format!("{:?}", owner_indices),
                n0 = format!("({:.4}, {:.4}, {:.4})", n0.x, n0.y, n0.z),
                n1 = format!("({:.4}, {:.4}, {:.4})", n1.x, n1.y, n1.z),
                dot_product = dot,
                verdict = if is_tangent { "TANGENT (|dot|>0.9962) → dashed" } else { "feature edge → keep" },
                "detect_tangent_edges",
            );
        } else if owners.len() >= 2 {
            // Non-manifold edge (≥3 faces share it). Pairwise tangent
            // check; if every pair is tangent, treat as Tangent.
            let mut all_pairs_tangent = true;
            let mut min_abs_dot = 1.0_f64;
            for i in 0..owners.len() {
                for j in (i + 1)..owners.len() {
                    let n0 = faces[owners[i].0].normal_at(mid);
                    let n1 = faces[owners[j].0].normal_at(mid);
                    let l0 = n0.length(); let l1 = n1.length();
                    let dot = if l0 > 1.0e-9 && l1 > 1.0e-9 { n0.dot(n1) / (l0 * l1) } else { 0.0 };
                    if dot.abs() < min_abs_dot { min_abs_dot = dot.abs(); }
                    if dot.abs() <= 0.9962 { all_pairs_tangent = false; }
                }
            }
            if all_pairs_tangent { classified.insert(*key, TangentKind::Tangent); }
            tracing::info!(
                key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
                owners = format!("{:?}", owner_indices),
                counts = format!("{:?}", owner_counts),
                min_abs_dot = min_abs_dot,
                verdict = if all_pairs_tangent { "TANGENT (all pairs |dot|>0.9962) → dashed" } else { "non-manifold feature edge → keep" },
                "detect_tangent_edges",
            );
        } else {
            tracing::info!(
                key_mid = format!("({}, {}, {})", key[1][0], key[1][1], key[1][2]),
                owners = format!("{:?}", owner_indices),
                counts = format!("{:?}", owner_counts),
                verdict = "boundary edge (single owner, count 1) → keep",
                "detect_tangent_edges",
            );
        }
    }
    classified
}

/// Classify an edge by its curve type and, for non-straight edges, sample
/// the analytic curve into a polyline the viewer can draw smoothly. The
/// per-face mesh tessellation can't be relied on for edge rendering — each
/// face independently chord-approximates the shared edge, so two faces
/// joining on a curve produce visibly different chord polylines that stack
/// onto each other. Sampling here from the BRep curve gives one canonical
/// polyline per edge. Tangential-deflection's defaults inside
/// `approximation_segments` (0.1 angular, 0.1 chord) match the mesh
/// tessellator's coarse-but-sufficient setting.
pub(crate) fn sample_edge_curve(
    edge: &opencascade::primitives::Edge,
) -> (bool, Option<Vec<[f64; 3]>>) {
    use opencascade::primitives::EdgeType;
    let kind = edge.edge_type();
    if matches!(kind, EdgeType::Line) {
        return (true, None);
    }
    let pts: Vec<[f64; 3]> = edge
        .approximation_segments()
        .map(|p| [p.x, p.y, p.z])
        .collect();
    // Degenerate / un-samplable edges fall back to the endpoint-only
    // representation. Two or fewer points isn't worth carrying — the
    // straight-edge renderer handles it identically.
    if pts.len() < 3 {
        return (false, None);
    }
    (false, Some(pts))
}

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
