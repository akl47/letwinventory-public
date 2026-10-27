# C++ CAD Kernel — migration plan (replace Rust + opencascade-rs)

## Decision

Replace the Rust CAD kernel (`cad-kernel/`, which wraps OCCT via the
`opencascade-rs` cxx binding) with a **native C++ kernel that links OCCT 8.0
directly**.

**Why:**
- `opencascade-rs` is a single-maintainer, part-time open-source project pinned
  to OCCT 7.x. It's a dependency risk for a core component, and every OCCT major
  upgrade (e.g. 7.x → 8.0) requires hand-porting its FFI declarations (removed
  `Handle_<Class>` typedefs, deleted headers, `int → size_t` NCollection
  changes, signature changes). We hit all of these.
- OCCT *is* C++. A C++ kernel calls it directly — **no FFI, no binding layer, no
  per-version port tax ever again**. Full API surface, all OCCT docs/examples
  apply directly.
- There is no requirement to use Rust here (the original constraint was "avoid
  Python's deploy/ops surface", not "use Rust"). C++ satisfies that and is the
  natural fit for OCCT.

## Scope / boundary (small blast radius)

The kernel is an isolated service behind a fixed **JSON-RPC 2.0 over TCP**
protocol (line-delimited JSON, one request per line). We keep that protocol
**byte-compatible**, so:

- ✅ **Frontend (Angular CAD editor/viewer/sketcher) — untouched.**
- ✅ **Backend orchestration (`backend/services/cadRegenService.js` and the VCS /
  freeze / diff / branch services) — untouched.** It keeps sending the same
  `buildExtrude` / `buildBoolean` / … requests.
- 🔁 **Only `cad-kernel/` is deleted and rewritten in C++.**

The protocol contract is defined by the existing Rust `cad-kernel/src/protocol.rs`
(field names + `#[serde(rename=...)]`) and the frontend types in
`frontend/src/app/cad/lib/{profile,types}.ts`. Treat those as the spec; do not
change field names on either side without a coordinated change.

## Stack

- **C++17**, **CMake**, **OCCT 8.0** (already built from source to `/usr/local`
  in the Docker image — that layer is reusable).
- **JSON:** `nlohmann/json` (header-only).
- **Server:** plain TCP, **thread-per-connection** (std::thread). This directly
  fixes the heartbeat bug we hit: a long/blocking OCCT op on one connection must
  not stop `ping` on another connection. Each connection gets its own thread, so
  the status probe is answered even while a build runs.
- **Resilience (port the 3 mechanisms we rely on):**
  - Wrap every op in `try/catch (Standard_Failure&)` → return a JSON-RPC error
    (OCCT throws on degenerate input).
  - Keep an **op-watchdog** thread that force-exits the process if a handler runs
    past `CAD_KERNEL_OP_TIMEOUT_MS` (an uncancellable OCCT hang) so the
    supervisor restarts a clean kernel. (Same env var, same behaviour.)
  - Docker `restart: unless-stopped` brings the process back.

## RPC method inventory (parity checklist)

Reach parity method-by-method. Each must produce the same JSON result shape the
backend already parses.

- [ ] `ping` → `{ ok, build, namingSchemaVersion }`
- [ ] `buildExtrude` (start/end conditions, midPlane, throughAll, upToVertex/
      upToSurface/offsetFromSurface, upToBody/upToNext via `untilBrep(s)`, dir-2)
- [ ] `buildBoolean` (Fuse/Cut/Common; result decomposed into solids)
- [ ] `buildRevolve`
- [ ] `buildSweep`
- [ ] `buildLoft`
- [ ] `buildShell`
- [ ] `buildPattern` (linear/circular/mirror transforms → fuse)
- [ ] `buildToolPattern`
- [ ] `buildFeaturePattern`
- [ ] `buildEdgeBlend` (fillet / chamfer)
- [ ] `bodyVolume` (exact analytic volume + centroid)
- [ ] `exportStl` (binary STL, base64)
- [ ] `exportStep`

Shared result building blocks every op needs:
- **Tessellation** — per-face mesh (positions/normals/indices) + `isFlat`.
- **Topology extraction** — deduped vertices + edges, with the seam/tangent
  classification (drop parametric seams; the coplanar/co-domain seam handling
  that fixes `e86`/`e97` — OCCT 8.0's improved `UnifySameDomain` should make this
  cleaner at the source).
- **Persistent face/edge naming** — the subtle, load-bearing piece (face IDs must
  survive regen/merge so sketches/refs stay attached). Port the JSON
  persistent-name scheme exactly (`{feature_id, role, sub_index, upstream_refs}`
  for faces; `<bodyId>/eN` positional for edges). This is the highest-risk part;
  build + validate it early.
- **BRep serialization** (base64) for the cumulative-body pipeline + freeze.

## Build / Docker

- Factor the OCCT 8.0 source build into its own base image (e.g.
  `cad-kernel-occt8-base`) so it's built once and both the C++ kernel and any
  throwaway tooling reuse it. The current `cad-kernel/Dockerfile` already builds
  OCCT 8.0 to `/usr/local`; lift that RUN into the base image.
- C++ kernel image: `FROM occt8-base` → `cmake` build → slim runtime stage that
  copies `/usr/local/lib` (OCCT `.so`) + the kernel binary.

## Rollout (no downtime, controlled risk)

1. Keep the **working OCCT-7.6 Rust kernel running** the entire time
   (`occt7-fallback` image tagged).
2. Build the C++ kernel **alongside** on a different image/port; bring it to
   parity against this checklist.
3. Validate against real scenarios — including **part 585** (the coincident-face
   fuse + `e86`/`e97`) and the extrude end-condition / boolean cases.
4. Cut the compose service over to the C++ kernel only once it passes.
5. Delete `cad-kernel/` (Rust + vendored `opencascade-rs`).

## Notes

- Cached `DesignBRepCache` / saved models can be wiped — the kernel rewrite
  changes BRep/naming details, and the user has confirmed existing kernel data is
  disposable. Feature trees (the parametric definitions) regenerate fresh.
- `NAMING_SCHEMA_VERSION` bumps on cutover so stale cache rows re-run.
