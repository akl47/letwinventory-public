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
use opencascade::primitives::Shape;

use crate::naming::PersistentName;
use crate::protocol::{FaceMesh, Topology, TopologyEdge, TopologyVertex};

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
    for (i, (_x, _y, _z, face)) in faces.into_iter().enumerate() {
        let face_shape: Shape = (&face).into();
        let mesh = face_shape
            .mesh_with_tolerance(DEFAULT_CHORD_TOLERANCE)
            .context("BRepMesh failed on a face")?;
        let (positions, normals, indices) = flatten_mesh(&mesh);
        let persistent = PersistentName::side(feature_id, i as u32);
        let id = persistent.encode();
        out.push(FaceMesh {
            face_id: id.clone(),
            persistent_name: id,
            is_flat: looks_flat(&normals),
            positions,
            normals,
            indices,
        });
    }
    Ok(out)
}

/// Extract vertex + edge topology from a shape with deduped vertex
/// positions. Same algorithm as `extrude::extract_topology` but lifted
/// out so booleans + future ops can reuse it.
pub fn extract_topology(shape: &Shape) -> Topology {
    let mut vertices: Vec<TopologyVertex> = Vec::new();
    let mut edges: Vec<TopologyEdge> = Vec::new();
    let mut seen_v: std::collections::HashSet<[i64; 3]> = std::collections::HashSet::new();
    let mut v_id_counter = 0usize;

    fn quantize(v: DVec3) -> [i64; 3] {
        const STEP: f64 = 1.0e6;
        [(v.x * STEP).round() as i64, (v.y * STEP).round() as i64, (v.z * STEP).round() as i64]
    }

    for (e_idx, edge) in shape.edges().enumerate() {
        let start = edge.start_point();
        let end = edge.end_point();
        for p in [start, end] {
            let key = quantize(p);
            if seen_v.insert(key) {
                vertices.push(TopologyVertex {
                    id: format!("v{}", v_id_counter),
                    position: [p.x, p.y, p.z],
                });
                v_id_counter += 1;
            }
        }
        edges.push(TopologyEdge {
            id: format!("e{}", e_idx),
            is_straight: true,
            endpoints: [[start.x, start.y, start.z], [end.x, end.y, end.z]],
        });
    }
    Topology { vertices, edges }
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
