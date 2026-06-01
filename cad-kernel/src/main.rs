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

/// Bump whenever the topological-naming algorithm in `naming.rs` OR the
/// shape of the kernel's BRep/mesh output changes. BRep cache entries
/// tagged with an older version must be recomputed. Mirrored by
/// `NAMING_VERSION` in `backend/services/cadRegenService.js`. See
/// `NAMING.md`.
///
/// 2: arcs in extruded profiles use real OCCT `three_point_arc` edges
///    instead of the previous chord-segment approximation.
/// 3: profiles became regions (outer loop + 0..N inner holes). Donut /
///    annular extrudes are produced via Face::subtract → CompoundFace
///    rather than only-outer-wire faces.
/// 4: ExtrudeFeature gained endCondition. Mid Plane / Through All
///    resolve in the backend (kernel-shape unchanged) — version bumped
///    so existing cache rows re-run through the new translator path.
/// 5: cumulative-body pipeline. Every feature's output is the union /
///    cut of its prism with the running body. Adds buildBoolean RPC.
/// 6: buildRevolve RPC lands. New feature kind in the cumulative
///    pipeline; existing extrudes produce byte-identical output.
/// 7: multi-body. ExtrudeFeature.merge controls whether the new prism
///    fuses into the most-recent body or creates a new one. Backend-
///    only change; kernel ops are unchanged.
/// 8: extrude direction 2 + start offset. buildExtrude folds both into
///    a single prism (translate start back by d2, extrude d1+d2) so no
///    internal parting face remains at the sketch plane. Kernel-side
///    geometry change; older caches must rebuild.
/// 9: buildSweep RPC lands. Sweep + Cut Sweep features land in the
///    cumulative pipeline. Existing extrudes/revolves produce
///    byte-identical output; bumped so backend + kernel stay in sync.
/// 10: sweep now uses BRepOffsetAPI_MakePipeShell (forgiving, handles
///     sharp corners) instead of MakePipe (C1-only). Different topology
///     output; cached sweep results from v9 are invalid.
/// 11: MakeRevol constructors wrapped in Result via cxx so OCCT
///     exceptions no longer abort the kernel. Geometry unchanged for
///     successful cases; bumping so callers see the new error path.
/// 12: boolean ops decompose their result into independent solids
///     (TopExp_Explorer TopAbs_SOLID). BuildBooleanResult gains a
///     `solids: Vec<SolidPart>` field so the backend can track
///     multi-body splits SolidWorks-style. Geometry unchanged for the
///     single-solid case; bumping so v11 cache rows rebuild fresh
///     under the new schema.
/// 13: matches backend bump — invalidates v12 cache rows that may
///     have been written before the backend's solids-storage edits
///     fully shipped (nodemon mid-edit reload). Kernel unchanged.
/// 16: shell op's MakeThickSolid shim now runs BRepCheck_Analyzer
///     and rejects malformed-but-IsDone-true shapes. Pre-bump cache
///     rows could store the malformed geometry as a "successful"
///     output; bumping forces every shell to re-dispatch.
/// 17: matches backend bump — v16 cache rows still held the
///     pre-validity-check garbage. Bumping again to evict.
/// 18: instrumentation added inside try_offset_solid_inward to flag
///     when the inner-offset returns an open shell rather than a
///     closed solid. Pre-bump shell results may have stored such a
///     malformed cavity.
/// 19: shell's Stage 2 punch-through prism direction fixed (was
///     extruding outward / away from the body; now extrudes inward
///     so the picked face actually opens). Bumping to evict the
///     cached "closed cavity inside intact body" results.
/// 20: prism cross-section was still wrong (matched OUTER picked
///     face = whole-body cross-section, so subtract removed wall
///     material around cavity). Now matches inner cavity's
///     corresponding face and extrudes from THAT, so the prism has
///     the cavity's smaller cross-section.
pub const NAMING_SCHEMA_VERSION: u32 = 20;

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

    // Install a C++ std::terminate handler that prints the active
    // exception's what() string before aborting. We can't recover from
    // terminate (UB), but every OCCT throw we DON'T catch should at
    // least leave a diagnosable log line so we know which call to wrap
    // in try_construct_unique next.
    opencascade::install_terminate_handler();

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
