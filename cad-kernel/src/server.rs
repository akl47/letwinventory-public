//! Unix-domain-socket JSON-RPC 2.0 server.
//!
//! Wire format is line-delimited UTF-8 JSON: one JSON object per `\n`. We
//! avoid length-prefixing because Node's `readline` is the natural client
//! and the protocol stays trivially debuggable with `socat` / `nc -U`.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::Ordering;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tracing::{debug, error, info, warn};

use crate::ops;
use crate::protocol::{
    RpcBody, RpcError, RpcRequest, RpcResponse,
    INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR,
};
use crate::REQUEST_COUNT;

pub async fn serve(socket_path: &Path) -> Result<()> {
    let listener =
        UnixListener::bind(socket_path).with_context(|| format!("bind {}", socket_path.display()))?;

    // Restrict the socket to the user running the process. Node API server
    // runs as the same Unix user in the Proxmox deploy.
    let mut perms = std::fs::metadata(socket_path)?.permissions();
    perms.set_mode(0o600);
    std::fs::set_permissions(socket_path, perms)?;
    info!(socket = %socket_path.display(), "listening");

    loop {
        let (stream, _addr) = listener.accept().await.context("accept")?;
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream).await {
                warn!(error = %e, "connection error");
            }
        });
    }
}

async fn handle_connection(stream: UnixStream) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    info!("client connected");
    while let Some(line) = lines.next_line().await.transpose() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                warn!(error = %e, "read error");
                break;
            }
        };
        let resp = dispatch(&line).await;
        if let Some(resp_str) = resp {
            if let Err(e) = writer.write_all(resp_str.as_bytes()).await {
                warn!(error = %e, "write error");
                break;
            }
            if let Err(e) = writer.write_all(b"\n").await {
                warn!(error = %e, "write newline error");
                break;
            }
            if let Err(e) = writer.flush().await {
                warn!(error = %e, "flush error");
                break;
            }
        }
    }
    info!("client disconnected");
    Ok(())
}

/// Parse one request line and produce the response JSON string. Returns
/// `None` for JSON-RPC notifications (no `id`) where the spec mandates no
/// response.
async fn dispatch(line: &str) -> Option<String> {
    REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);

    let req: RpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return Some(serialize(error_response(Value::Null, PARSE_ERROR, &e.to_string())));
        }
    };

    let req_id = req.id.clone().unwrap_or(Value::Null);
    let is_notification = req.id.is_none();

    if req.jsonrpc != "2.0" {
        if is_notification {
            return None;
        }
        return Some(serialize(error_response(
            req_id,
            INVALID_REQUEST,
            "jsonrpc must be \"2.0\"",
        )));
    }

    let result = run_handler(&req.method, req.params).await;

    if is_notification {
        return None;
    }

    let resp = match result {
        Ok(value) => RpcResponse {
            jsonrpc: "2.0",
            id: req_id,
            body: RpcBody::Ok { result: value },
        },
        Err(HandlerError { code, message, data }) => RpcResponse {
            jsonrpc: "2.0",
            id: req_id,
            body: RpcBody::Err {
                error: RpcError { code, message, data },
            },
        },
    };
    Some(serialize(resp))
}

#[derive(Debug)]
struct HandlerError {
    code: i32,
    message: String,
    data: Option<Value>,
}

async fn run_handler(method: &str, params: Value) -> Result<Value, HandlerError> {
    debug!(method, "dispatching");
    match method {
        "ping" => Ok(json!({ "ok": true })),
        "buildExtrude" => {
            let params: crate::protocol::BuildExtrudeParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            match ops::extrude::build(&params) {
                Ok(result) => serde_json::to_value(result).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Err(e) => {
                    error!(error = %e, "buildExtrude failed");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: e.to_string(),
                        data: None,
                    })
                }
            }
        }
        _ => Err(HandlerError {
            code: METHOD_NOT_FOUND,
            message: format!("unknown method {method:?}"),
            data: None,
        }),
    }
}

fn error_response(id: Value, code: i32, message: &str) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        body: RpcBody::Err {
            error: RpcError {
                code,
                message: message.to_string(),
                data: None,
            },
        },
    }
}

fn serialize(resp: RpcResponse) -> String {
    serde_json::to_string(&resp).expect("RpcResponse always serializes")
}
