# cad-kernel — server-side CAD kernel service

Rust sidecar process that holds the canonical BRep state for the CAD product.
Wraps OCCT via the [`opencascade`](https://crates.io/crates/opencascade) crate.
Communicates with the Node API server over a Unix-domain socket using
line-delimited JSON-RPC 2.0.

See `docs/cad-architecture-pivot-plan.md` (in the repo root) for the broader
architecture this fits into.

## Build prerequisites

- Rust 1.75 or later (`rustup`)
- OCCT 7.7.x development headers + libraries on the build host
  (Debian/Ubuntu: `apt install libocct-foundation-dev libocct-modeling-data-dev
  libocct-modeling-algorithms-dev libocct-ocaf-dev libocct-data-exchange-dev`;
  the `opencascade-sys` crate builds against the system OCCT)
- `cmake`, `clang`, `pkg-config` (build-time dependencies of `cxx`)

BREP serialization is OCCT-version-sensitive — pin OCCT exactly and treat
upgrades as data migrations (recompute cache from feature definitions).

## Build

```bash
cd cad-kernel
cargo build --release
```

First build is slow because `opencascade-sys` compiles cxx bridge code
against OCCT. Subsequent builds are incremental.

## Run

```bash
# default socket path: /tmp/letwinventory-cad-kernel.sock
cargo run --release

# override the socket path
CAD_KERNEL_SOCKET=/var/run/cad-kernel.sock cargo run --release
```

The Node API server spawns this as a child process via `child_process.spawn`
on startup. See `backend/services/cadKernelClient.js` (forthcoming in Phase 1)
or `backend/scripts/cad-spike.js` for the wire protocol.

## Test the spike end-to-end

```bash
# In one terminal:
cd cad-kernel && cargo run --release

# In another:
node backend/scripts/cad-spike.js               # cylinder
node backend/scripts/cad-spike.js --rectangle   # 4-line polygon
node backend/scripts/cad-spike.js --flipped     # reversed direction
```

Expected output: a JSON dump of an extruded body — 3 faces for a circle
(top cap, bottom cap, lateral), 6 faces for a rectangle (2 caps + 4 sides) —
with positions/normals/indices for each face, plus the BRep bytes.

## Protocol

Line-delimited JSON-RPC 2.0 over the Unix socket. Each request and response
is exactly one line of UTF-8 JSON, terminated by `\n`.

Request:
```json
{"jsonrpc": "2.0", "id": 1, "method": "buildExtrude", "params": {...}}
```

Response:
```json
{"jsonrpc": "2.0", "id": 1, "result": {...}}
```

Errors use the JSON-RPC error envelope (see `src/protocol.rs`).

## Architectural notes

- **State ownership:** kernel holds BRep in memory per active session.
  Sessions evict on idle (Phase 1). The Postgres-backed BRep cache (Phase 1,
  see `DesignBRepCache` table) lets any worker rehydrate any session —
  sessions are *not* sticky to a process.

- **Topological naming:** see `NAMING.md`. Persistent face/edge IDs are
  derived from generative history so downstream features (fillets, cuts on
  specific edges) survive parameter changes that preserve topology.

- **Why not pure-Rust CAD (`truck`)?** truck is a clean-sheet Rust kernel
  but its boolean ops and surfacing aren't production-ready. OCCT is the
  industry-standard kernel; we accept the C++ FFI cost via `opencascade-rs`
  to get correctness and feature completeness.

## RPC methods (Phase 0 spike scope)

| Method | Status |
| ---- | ---- |
| `ping` | ✓ implemented |
| `buildExtrude` | ✓ implemented |
| `regenerateFromFeature` | Phase 1 |
| `applyEdit` | Phase 1 |
| `closeSession` | Phase 1 |
