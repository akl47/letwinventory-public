//! JSON-RPC 2.0 envelope + request/response payload types.
//!
//! Field names exactly match what the Frontend types in
//! `frontend/src/app/cad/lib/profile.ts` and `types.ts` emit. Don't rename
//! them on either side without a coordinated change.

use serde::{Deserialize, Serialize};

// ────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 envelope
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    /// Notifications omit `id`; we return no response in that case.
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(flatten)]
    pub body: RpcBody,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RpcBody {
    Ok { result: serde_json::Value },
    Err { error: RpcError },
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

// JSON-RPC 2.0 spec error codes — stay aligned so a generic client library
// can map them cleanly if we swap one in later.
pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;

// ────────────────────────────────────────────────────────────────────────────
// Geometry primitives shared with the frontend
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Plane3 {
    /// World-space origin of the host plane.
    pub origin: [f64; 3],
    /// In-plane basis vector 1 (unit-length, perpendicular to `normal`).
    #[serde(rename = "xAxis")]
    pub x_axis: [f64; 3],
    /// In-plane basis vector 2 (unit-length, normal × x_axis).
    #[serde(rename = "yAxis")]
    pub y_axis: [f64; 3],
    /// Outward unit normal.
    pub normal: [f64; 3],
}

/// Typed profile loop matching `frontend/src/app/cad/lib/profile.ts:ProfileEdge`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProfileEdge {
    Line {
        start: Point2,
        end: Point2,
    },
    Arc {
        center: Point2,
        radius: f64,
        #[serde(rename = "startAngle")]
        start_angle: f64,
        #[serde(rename = "endAngle")]
        end_angle: f64,
        ccw: bool,
        start: Point2,
        end: Point2,
    },
    Circle {
        center: Point2,
        radius: f64,
    },
}

// ────────────────────────────────────────────────────────────────────────────
// buildExtrude
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BuildExtrudeParams {
    #[serde(rename = "featureId", default = "default_feature_id")]
    pub feature_id: String,
    pub profile: Vec<ProfileEdge>,
    pub plane: Plane3,
    pub distance: f64,
    #[serde(default)]
    pub flipped: bool,
}

fn default_feature_id() -> String {
    "f_anon".to_string()
}

#[derive(Debug, Serialize)]
pub struct BuildExtrudeResult {
    /// BREP serialization (text form for Phase 0; binary `BinTools` payload
    /// in Phase 1) base64-encoded for JSON transport.
    #[serde(rename = "brepBytes")]
    pub brep_bytes: String,
    pub faces: Vec<FaceMesh>,
    pub topology: Topology,
}

#[derive(Debug, Serialize)]
pub struct FaceMesh {
    /// The persistent name (see `naming.rs`) doubles as the face identifier.
    #[serde(rename = "faceId")]
    pub face_id: String,
    #[serde(rename = "persistentName")]
    pub persistent_name: String,
    #[serde(rename = "isFlat")]
    pub is_flat: bool,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
}

#[derive(Debug, Default, Serialize)]
pub struct Topology {
    pub vertices: Vec<TopologyVertex>,
    pub edges: Vec<TopologyEdge>,
}

#[derive(Debug, Serialize)]
pub struct TopologyVertex {
    pub id: String,
    pub position: [f64; 3],
}

#[derive(Debug, Serialize)]
pub struct TopologyEdge {
    pub id: String,
    #[serde(rename = "isStraight")]
    pub is_straight: bool,
    pub endpoints: [[f64; 3]; 2],
}
