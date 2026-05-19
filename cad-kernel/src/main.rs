//! `cad-kernel` — server-side CAD kernel service.
//!
//! Listens on a TCP socket and speaks line-delimited JSON-RPC 2.0.
//! See `README.md` for the wire protocol and architecture notes.
//!
//! Bind address comes from `CAD_KERNEL_ADDR` (default `127.0.0.1:9876`). Use
//! `0.0.0.0:9876` if the kernel needs to be reachable from inside a Docker
//! container running on the same host (the typical dev setup).

use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result};
use tokio::signal::unix::{signal, SignalKind};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

mod naming;
mod ops;
mod protocol;
mod server;

/// Bump whenever the topological-naming algorithm in `naming.rs` changes.
/// BRep cache entries tagged with an older version must be recomputed. See
/// `NAMING.md`.
pub const NAMING_SCHEMA_VERSION: u32 = 1;

/// Default bind address. Override with `CAD_KERNEL_ADDR`. We default to
/// `0.0.0.0` because the standard dev setup runs the Node backend in Docker,
/// and a containerized backend reaches the host kernel via the bridge
/// gateway IP (not loopback) — `127.0.0.1` would refuse those connections.
/// Threat model: dev box behind LAN firewall, prod box behind pfSense; an
/// unauthenticated kernel exposed to those networks is acceptable.
const DEFAULT_BIND_ADDR: &str = "0.0.0.0:9876";

/// Global request counter — informational, surfaced via logs.
pub(crate) static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing();

    let bind_addr = std::env::var("CAD_KERNEL_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
    info!(addr = %bind_addr, "starting cad-kernel");

    // Spawn the listener in the background so we can wait on SIGTERM/SIGINT
    // in parallel and shut down cleanly.
    let listener_addr = bind_addr.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = server::serve(&listener_addr).await {
            error!(error = %e, "server task exited with error");
        }
    });

    // Wait for either signal; either tears down the listener.
    let mut term = signal(SignalKind::terminate()).context("install SIGTERM handler")?;
    let mut int = signal(SignalKind::interrupt()).context("install SIGINT handler")?;
    tokio::select! {
        _ = term.recv() => info!("SIGTERM received"),
        _ = int.recv() => info!("SIGINT received"),
    }

    handle.abort();
    let _ = handle.await;
    let total = REQUEST_COUNT.load(Ordering::Relaxed);
    info!(total_requests = total, "cad-kernel stopped");
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("CAD_KERNEL_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();
}
