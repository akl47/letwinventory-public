//! TCP JSON-RPC 2.0 server.
//!
//! Wire format is line-delimited UTF-8 JSON: one JSON object per `\n`. We
//! avoid length-prefixing because Node's `readline` is the natural client
//! and the protocol stays trivially debuggable with `nc localhost 9876`.
//!
//! Bind address is host:port (e.g. `127.0.0.1:9876` or `0.0.0.0:9876`) —
//! TCP rather than Unix socket so the kernel can be reached across Docker
//! container boundaries on the same host without socket-file bind mounts.

use std::sync::atomic::Ordering;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, error, info, warn};

use crate::ops;
use crate::protocol::{
    RpcBody, RpcError, RpcRequest, RpcResponse,
    INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR,
};
use crate::REQUEST_COUNT;

// ───────── Operation watchdog ───────────────────────────────────────────────
//
// A hung OCCT call (an infinite-loop boolean / mesh that never returns) can't
// be cancelled from Rust, so it wedges the request loop forever — and Docker's
// `restart: unless-stopped` only fires on process EXIT, which a hang never
// reaches. This watchdog force-exits the process if any handler runs longer
// than CAD_KERNEL_OP_TIMEOUT_MS, so the supervisor restarts a clean kernel and
// the in-flight RPC fails with a disconnect (surfaced as an error by the
// backend) instead of hanging the whole service indefinitely. Rust panics are
// already caught in run_handler and C++ aborts already exit→restart; this
// closes the remaining HANG gap.
use std::sync::atomic::AtomicU64;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 0 = idle, else the unix-millis deadline the in-flight handler must finish by.
static OP_DEADLINE_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn op_timeout_ms() -> u64 {
    std::env::var("CAD_KERNEL_OP_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(60_000)
}

/// Soft per-boolean timeout. A normal `clean()` (UnifySameDomain) finishes in
/// well under a second; the pathological coincident-face fuse loops for minutes.
/// When the boolean exceeds this on its blocking thread, the server abandons it
/// and retries with `clean()` skipped so the feature still builds. Tunable via
/// CAD_KERNEL_CLEAN_TIMEOUT_MS.
fn clean_timeout_ms() -> u64 {
    std::env::var("CAD_KERNEL_CLEAN_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(10_000)
}

/// Start the background watchdog thread. Call once at startup.
pub fn start_watchdog() {
    std::thread::Builder::new()
        .name("op-watchdog".to_string())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_millis(1000));
            let deadline = OP_DEADLINE_MS.load(Ordering::Relaxed);
            if deadline != 0 && now_ms() > deadline {
                // eprintln (not tracing) so it flushes even if the async runtime
                // is starved by the blocking call. Non-zero exit → Docker
                // `restart: unless-stopped` brings up a fresh kernel.
                eprintln!(
                    "[watchdog] a kernel handler ran past {} ms with no result — \
                     aborting process for supervisor restart",
                    op_timeout_ms()
                );
                std::process::exit(13);
            }
        })
        .expect("spawn op-watchdog thread");
}

/// RAII: arm the watchdog deadline for one handler call, clear it on drop.
/// Assumes effectively-serial requests (the backend shares ONE connection);
/// the CAS-clear avoids a finishing op clearing another's deadline if two ever
/// overlap on separate connections.
struct OpGuard {
    deadline: u64,
}
impl OpGuard {
    fn arm() -> Self {
        let deadline = now_ms() + op_timeout_ms();
        OP_DEADLINE_MS.store(deadline, Ordering::Relaxed);
        OpGuard { deadline }
    }
}
impl Drop for OpGuard {
    fn drop(&mut self) {
        let _ =
            OP_DEADLINE_MS.compare_exchange(self.deadline, 0, Ordering::Relaxed, Ordering::Relaxed);
    }
}

pub async fn serve(bind_addr: &str) -> Result<()> {
    let listener =
        TcpListener::bind(bind_addr).await.with_context(|| format!("bind {bind_addr}"))?;
    info!(addr = bind_addr, "listening");

    loop {
        let (stream, peer) = listener.accept().await.context("accept")?;
        // TCP_NODELAY: regen replies are small JSON blobs — disabling Nagle's
        // algorithm keeps latency predictable at the cost of marginal extra
        // packets. Worth it for an interactive CAD editor's expected payloads.
        let _ = stream.set_nodelay(true);
        tokio::spawn(async move {
            info!(peer = %peer, "client connected");
            if let Err(e) = handle_connection(stream).await {
                warn!(error = %e, "connection error");
            }
        });
    }
}

async fn handle_connection(stream: TcpStream) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
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

    // Arm the watchdog for the duration of this handler so a hung OCCT call
    // can't wedge the kernel forever (see start_watchdog).
    let result = {
        let _op_guard = OpGuard::arm();
        run_handler(&req.method, req.params).await
    };

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
        "ping" => Ok(json!({
            "ok": true,
            "build": crate::KERNEL_BUILD,
            "namingSchemaVersion": crate::NAMING_SCHEMA_VERSION,
        })),
        "buildExtrude" => {
            let params: crate::protocol::BuildExtrudeParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            // Rust-side panic guard. Doesn't catch C++ exceptions from OCCT
            // (those still abort the process — supervisor restarts), but
            // contains any panic from our own Rust code so one bad request
            // can't crash the kernel.
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::extrude::build(&params)
            }));
            let result = match outcome {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    error!(error = %e, "buildExtrude failed");
                    return Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: e.to_string(),
                        data: None,
                    });
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildExtrude panicked");
                    return Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    });
                }
            };
            serde_json::to_value(result).map_err(|e| HandlerError {
                code: INTERNAL_ERROR,
                message: format!("serialize result: {e}"),
                data: None,
            })
        }
        "buildRevolve" => {
            let params: crate::protocol::BuildRevolveParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::revolve::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildRevolve failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildRevolve panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildBoolean" => {
            let params: crate::protocol::BuildBooleanParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            // Run the boolean on a BLOCKING thread (not an async worker) so a
            // slow/hung OCCT call — notably UnifySameDomain `clean()` on
            // coincident-face fuses — can't freeze the async runtime. The kernel
            // keeps answering pings + other requests (true liveness for the
            // editor's heartbeat). If `clean()` blows past the soft timeout, the
            // boolean is retried with `clean()` skipped: the un-cleaned union is
            // valid geometry, so the feature still BUILDS rather than hanging the
            // kernel into a watchdog kill. The abandoned clean() thread finishes
            // in the background (or is reclaimed on restart); the backend caches
            // the result, so this happens at most once per geometry.
            let to = std::time::Duration::from_millis(clean_timeout_ms());
            let p1 = params.clone();
            let first = tokio::time::timeout(
                to,
                tokio::task::spawn_blocking(move || ops::boolean::build(&p1)),
            )
            .await;
            let result: Result<crate::protocol::BuildBooleanResult, HandlerError> = match first {
                Ok(Ok(Ok(r))) => Ok(r),
                Ok(Ok(Err(e))) => {
                    error!(error = %e, "buildBoolean failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Ok(Err(join_err)) => {
                    error!(error = %join_err, "buildBoolean panicked");
                    Err(HandlerError { code: INTERNAL_ERROR, message: format!("internal panic: {join_err}"), data: None })
                }
                Err(_elapsed) => {
                    // clean() (UnifySameDomain) blew past the soft timeout — almost
                    // always degenerate upstream geometry. We do NOT skip clean()
                    // and return the un-cleaned union: that yields a non-manifold,
                    // visually-unjoined result (worse than failing). Surface a clear
                    // error instead. The kernel stays alive because the op ran on a
                    // blocking thread (the async runtime was never frozen); the
                    // abandoned clean() thread finishes/reclaims in the background.
                    error!(
                        feature_id = %params.feature_id,
                        timeout_ms = clean_timeout_ms(),
                        "buildBoolean clean() exceeded soft timeout — failing the feature (likely degenerate upstream geometry)",
                    );
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!(
                            "Boolean cleanup (UnifySameDomain) exceeded {}ms — the fused geometry is \
                             degenerate (often a stale/invalid upstream body). Try regenerating from a \
                             clean cache, or simplify the feature.",
                            clean_timeout_ms()
                        ),
                        data: None,
                    })
                }
            };
            result.and_then(|r| {
                serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                })
            })
        }
        "bodyVolume" => {
            let params: crate::protocol::BodyVolumeParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::shape_io::body_volume(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "bodyVolume failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "bodyVolume panicked");
                    Err(HandlerError { code: INTERNAL_ERROR, message: format!("internal panic: {msg}"), data: None })
                }
            }
        }
        "buildEdgeBlend" => {
            let params: crate::protocol::BuildEdgeBlendParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::edge_blend::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildEdgeBlend failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildEdgeBlend panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildSweep" => {
            let params: crate::protocol::BuildSweepParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::sweep::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildSweep failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildSweep panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildShell" => {
            let params: crate::protocol::BuildShellParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::shell::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildShell failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildShell panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildPattern" => {
            let params: crate::protocol::BuildPatternParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::pattern::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildPattern failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildPattern panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildFeaturePattern" => {
            let params: crate::protocol::BuildFeaturePatternParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::feature_pattern::build(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildFeaturePattern failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildFeaturePattern panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildToolPattern" => {
            let params: crate::protocol::BuildToolPatternParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::feature_pattern::build_tool_pattern(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildToolPattern failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildToolPattern panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "buildLoft" => {
            let params: crate::protocol::BuildLoftParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::extrude::build_loft(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "buildLoft failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "buildLoft panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "exportStep" => {
            let params: crate::protocol::ExportStepParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::export::export_step(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "exportStep failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "exportStep panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
                        data: None,
                    })
                }
            }
        }
        "exportStl" => {
            let params: crate::protocol::ExportStlParams =
                serde_json::from_value(params).map_err(|e| HandlerError {
                    code: INVALID_PARAMS,
                    message: e.to_string(),
                    data: None,
                })?;
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ops::export::export_stl(&params)
            }));
            match outcome {
                Ok(Ok(r)) => serde_json::to_value(r).map_err(|e| HandlerError {
                    code: INTERNAL_ERROR,
                    message: format!("serialize result: {e}"),
                    data: None,
                }),
                Ok(Err(e)) => {
                    error!(error = %e, "exportStl failed");
                    Err(HandlerError { code: INTERNAL_ERROR, message: e.to_string(), data: None })
                }
                Err(panic) => {
                    let msg = panic_message(&panic);
                    error!(error = %msg, "exportStl panicked");
                    Err(HandlerError {
                        code: INTERNAL_ERROR,
                        message: format!("internal panic: {msg}"),
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

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() { return (*s).to_string(); }
    if let Some(s) = payload.downcast_ref::<String>() { return s.clone(); }
    "<non-string panic payload>".to_string()
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
