//! `cad-kernel` — server-side CAD kernel service.
//!
//! Listens on a Unix-domain socket and speaks line-delimited JSON-RPC 2.0.
//! See `README.md` for the wire protocol and architecture notes.

use std::path::PathBuf;
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

/// Default Unix-socket path. Override with `CAD_KERNEL_SOCKET`.
const DEFAULT_SOCKET_PATH: &str = "/tmp/letwinventory-cad-kernel.sock";

/// Global request counter — informational, surfaced via logs.
pub(crate) static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing();

    let socket_path: PathBuf = std::env::var("CAD_KERNEL_SOCKET")
        .unwrap_or_else(|_| DEFAULT_SOCKET_PATH.to_string())
        .into();

    info!(socket = %socket_path.display(), "starting cad-kernel");

    // Clean up stale socket from a previous crashed instance.
    if socket_path.exists() {
        std::fs::remove_file(&socket_path)
            .with_context(|| format!("removing stale socket at {}", socket_path.display()))?;
    }

    // Spawn the listener in the background so we can wait on SIGTERM/SIGINT
    // in parallel and shut down cleanly.
    let listener_path = socket_path.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = server::serve(&listener_path).await {
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
    let _ = std::fs::remove_file(&socket_path);
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
