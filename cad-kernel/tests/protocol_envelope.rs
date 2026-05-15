//! JSON-RPC envelope round-trip tests that DON'T require OCCT to be installed.
//!
//! Build them with `cargo test --test protocol_envelope`. These guard the
//! wire-protocol contract independently of the heavy OCCT dependency, so a
//! contributor without a working OCCT toolchain can still validate the
//! protocol layer.

use serde_json::json;

#[path = "../src/protocol.rs"]
mod protocol;

#[test]
fn parses_build_extrude_request_with_circle_profile() {
    let raw = json!({
        "featureId": "f1",
        "profile": [{ "kind": "circle", "center": { "x": 0, "y": 0 }, "radius": 10.0 }],
        "plane": {
            "origin": [0.0, 0.0, 0.0],
            "xAxis": [1.0, 0.0, 0.0],
            "yAxis": [0.0, 1.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
        },
        "distance": 20.0,
        "flipped": false,
    });
    let params: protocol::BuildExtrudeParams = serde_json::from_value(raw).unwrap();
    assert_eq!(params.feature_id, "f1");
    assert_eq!(params.profile.len(), 1);
    assert!(matches!(&params.profile[0], protocol::ProfileEdge::Circle { .. }));
    assert_eq!(params.distance, 20.0);
    assert!(!params.flipped);
}

#[test]
fn parses_build_extrude_request_with_line_polygon() {
    let raw = json!({
        "profile": [
            { "kind": "line", "start": { "x": 0, "y": 0 }, "end": { "x": 10, "y": 0 } },
            { "kind": "line", "start": { "x": 10, "y": 0 }, "end": { "x": 10, "y": 10 } },
            { "kind": "line", "start": { "x": 10, "y": 10 }, "end": { "x": 0, "y": 0 } },
        ],
        "plane": {
            "origin": [0.0, 0.0, 0.0],
            "xAxis": [1.0, 0.0, 0.0],
            "yAxis": [0.0, 1.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
        },
        "distance": 5.0,
    });
    let params: protocol::BuildExtrudeParams = serde_json::from_value(raw).unwrap();
    assert_eq!(params.profile.len(), 3);
    assert_eq!(params.feature_id, "f_anon");  // default
    assert!(!params.flipped);  // default
}

#[test]
fn response_serializes_with_jsonrpc_field() {
    let resp = protocol::RpcResponse {
        jsonrpc: "2.0",
        id: serde_json::Value::Number(7.into()),
        body: protocol::RpcBody::Ok { result: json!({ "ok": true }) },
    };
    let s = serde_json::to_string(&resp).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 7);
    assert_eq!(parsed["result"]["ok"], true);
}

#[test]
fn error_response_carries_code_and_message() {
    let resp = protocol::RpcResponse {
        jsonrpc: "2.0",
        id: serde_json::Value::Null,
        body: protocol::RpcBody::Err {
            error: protocol::RpcError {
                code: protocol::METHOD_NOT_FOUND,
                message: "unknown method \"frobnicate\"".into(),
                data: None,
            },
        },
    };
    let s = serde_json::to_string(&resp).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert_eq!(parsed["error"]["code"], -32601);
}

#[test]
fn rejects_unknown_profile_edge_kind() {
    let raw = json!({
        "profile": [{ "kind": "spline", "controlPointIds": ["a", "b"], "degree": 3 }],
        "plane": {
            "origin": [0.0, 0.0, 0.0],
            "xAxis": [1.0, 0.0, 0.0],
            "yAxis": [0.0, 1.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
        },
        "distance": 10.0,
    });
    let result: Result<protocol::BuildExtrudeParams, _> = serde_json::from_value(raw);
    assert!(result.is_err(), "spline kind should not parse as a Phase-0 ProfileEdge");
}
