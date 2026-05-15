# CAD Stack Architectural Pivot — Roadmap to SolidWorks-equivalent

## Context

We're building toward a real, shippable parametric CAD product with the scope of SolidWorks: sketching, modeling, assemblies, and drawings. The current stack is a fat client (pure-JS polygon kernel + PlaneGCS sketcher + Three.js viewer) talking to a dumb server (JSONB CRUD). It hits a wall well before "real product": no boolean operations (so no holes, no real parts), no proper BRep semantics (so no fillets/sweeps/lofts), no assemblies, no drawings, ~20-50 feature regen ceiling in the browser.

The user wants the client to remain lightweight — browser on commodity laptop. That means heavy CAD compute must move server-side. No existing CAD data needs to be preserved, so this is a clean-slate cutover.

Intended outcome: a parametric CAD system whose architecture supports the multi-year build toward SolidWorks parity, and whose Phase 1 ships a working server-side BRep kernel with one feature kind (Extrude) replacing the current pure-JS polygon path.

---

## Target Architecture

```
Browser (lightweight)                  Node API server                 Python kernel service
─────────────────────                  ───────────────                 ────────────────────
• Three.js viewer                      • REST: model CRUD              • CadQuery / OCP (raw OCCT)
• PlaneGCS sketch solver  ──HTTP──>    • WebSocket: CAD session  <──>  • Holds per-session BRep
  (client-side; constraint              • Bridges to kernel via            in memory
   graph persisted to server)            JSON-RPC over Unix socket      • Feature graph + incremental
• UI/tools/selection/snap              • Auth/permissions middleware      regen
• Receives mesh deltas                 • Serializes BRep cache to       • Per-feature BRep cache
  (binary frames over WS)                Postgres                         (BREP format, hashed)
                                                                        • Tessellation → mesh deltas
                                                                          to client
```

Key boundaries:
- **Sketch solver: client-side.** PlaneGCS in WASM (~700KB) gives sub-100ms feedback during draw; server round-trip would feel awful on slow connections. Constraint graph (not just resolved coordinates) is persisted to the server so the kernel can re-solve deterministically during regen and so future collaboration is unblocked.
- **Feature graph + BRep: server-side.** Single canonical state. Client never sees BRep, only tessellated meshes.
- **Geometry transport: WebSocket, two-frame protocol.** JSON-RPC for the control plane (operation requests, regen complete, errors), binary frames for mesh payloads (header + Float32 raw buffer). Mixing them in one frame is the trap — keep them separate.
- **featureTree JSONB stays authoritative.** BRep cache is *derived* — keyed by `(featureId, paramHash, upstreamHash)` — so any worker can rehydrate any session.

---

## Phase 0 — Kernel-service spike (1-2 weeks)

Stand up the minimum Python kernel service that can build an extrude and serialize the result.

**Deliverables:**
- New top-level `cad-kernel/` directory at repo root (Python, separate `pyproject.toml`).
- Single Python process, started as a sidecar to the Node API. Communicates over a Unix-domain socket using line-delimited JSON-RPC (avoid gRPC for now — protobuf schema churn isn't worth it while the feature schema is still moving weekly; migrate when stable).
- One RPC method: `buildExtrude({profile, plane, distance, flipped}) -> {brepBytes, faces[], topology}`. Profile uses the same typed-edge shape as `frontend/src/app/cad/lib/profile.ts` ProfileLoop.
- Returns serialized OCCT BREP bytes + tessellated face meshes + edge topology in one response (no streaming yet — that's Phase 1).
- Health check + restart-on-crash via systemd unit or whatever the Proxmox deploy uses.
- Pin OCCT version exactly. Document the pin in `cad-kernel/README.md`. BREP serialization is version-sensitive — treat OCCT upgrades as migrations.

**Risks to validate:**
- Python deploy footprint on Proxmox VM (adds a container/service). Confirm acceptable.
- LGPL-2.1 license on OCCT — fine for SaaS but document in legal posture.
- CadQuery's API gaps: profile some common ops (extrude, cut, fillet) and confirm CadQuery handles them, OR confirm we can drop to raw `OCP` bindings for the gaps. Keep a thin wrapper layer designed for `OCP` drop-down from day one.

**Exit criteria:** Node script can spawn the kernel, send a profile via JSON-RPC, receive BREP+meshes, validate that the BREP round-trips through OCCT's deserializer.

---

## Phase 1 — Architectural cutover (4-8 weeks)

Replace the entire client-side regen path. Sketches still draw client-side; everything else moves server-side.

### 1a. Backend additions

- **New WebSocket service** `backend/services/cadStreamService.js`, modeled on `backend/services/printAgentService.js`:
  - Path `/ws/cad`, authenticated via existing JWT (extract token from the connection upgrade headers, reuse the auth middleware logic).
  - Per-connection session state: `{userId, modelId, kernelProcessRef}`.
  - JSON-RPC control plane (text frames): `regenerateFeature`, `regenerateFromFeature`, `applyEdit`, `closeSession`.
  - Binary mesh frames: header (faceId u32, byteOffset u32, byteLen u32, version u32) + raw `Float32Array` payload. One face per frame.
- **New backend module** `backend/services/cadKernelClient.js`: thin JSON-RPC client to the Python kernel over Unix socket. Connection pool keyed by `modelId` for session affinity (advisory, not strict — any worker can rehydrate from BRep cache).
- **REST endpoint additions** in `backend/api/design/cad-model/controller.js`:
  - `POST /:id/regenerate` — full regen of the feature tree; returns the streaming WebSocket URL + session token for the client to connect.
  - `GET /:id/state` — current featureTree + sketchDoc (existing behaviour, fine as-is).
- **New table** `DesignBRepCache(id, modelId, featureId, paramHash, upstreamHash, brepBytes, tessellatedMeshes JSONB, createdAt, lastAccessedAt)` — keyed by the triple `(featureId, paramHash, upstreamHash)`. Idle eviction via background job (extend the existing 60-second poll pattern in `scheduledTaskService.js`) drops entries older than N days.
- **Permissions:** no new resource — `cad` resource already covers this (REQ 556).

### 1b. Python kernel service evolution

- Add `regenerateFromFeature(featureId)` RPC that walks the feature graph from that point downstream, consults the BRep cache, and only recomputes features with stale hashes.
- Per-feature input hash includes: feature's own params + upstream BRep hash. This is what makes the cache key correct.
- **Topological naming** (load-bearing — see below): persistent face/edge IDs derived from generative history, not from OCCT's internal numbering.
- Tessellation runs per face after each feature, results streamed back to Node via JSON-RPC results (Node forwards as binary frames to the browser).

### 1c. Frontend changes

- **Scrap:**
  - `frontend/src/app/cad/lib/kernel.ts` — pure-JS extrude is gone.
  - `frontend/src/app/cad/lib/featureTree.ts:regenerateModel` — regen no longer happens in browser.
  - `frontend/src/app/services/cad-kernel.service.ts` — OCCT no longer lazy-loaded in browser.
  - Lateral-face tessellation in `frontend/src/app/cad/lib/tessellator.ts` is still useful for the **active-sketch preview**, but no longer feeds an extrude.
- **Keep / extend:**
  - `frontend/src/app/cad/lib/store.ts` (sketch entity store) — unchanged.
  - `frontend/src/app/cad/lib/solver.ts` (PlaneGCS) — unchanged; sketch solving stays client-side.
  - `frontend/src/app/cad/lib/profile.ts` — `ProfileLoop` type stays; serialized to JSON-RPC payload.
  - `frontend/src/app/components/cad/cad-viewer/` — viewer becomes a mesh consumer. New signal `streamingFaces: Map<faceId, FaceMesh>` updated by the WebSocket client; the existing Three.js rendering path (with display modes, edge overlays, etc.) consumes this map.
  - `frontend/src/app/components/cad/cad-sketch-editor/` — when the user clicks Extrude, marshall the sketch state + extrude params and POST `/:id/regenerate`; receive the streaming session.
- **New service** `frontend/src/app/services/cad-stream.service.ts`: WebSocket client mirroring server protocol. Reconstructs `Float32Array` from binary frames and routes to the viewer's face map.

### 1d. Feature graph + topological naming

This is the actual hard problem in parametric CAD — not booleans. If a user fillets "the edge between face 3 and face 7" and an upstream change re-numbers faces, the fillet must still find the right edge. **Designing the naming scheme into Phase 1, before booleans land, is critical** — retrofitting it later is agony.

Approach (canonical CAD scheme):
- Each feature's output BRep is decorated with persistent IDs at creation time.
- A face/edge's persistent ID is derived from its generative history: which feature produced it, which inputs it came from, which sub-operation within the feature, in stable lexical order (not OCCT's internal numbering).
- Downstream features reference upstream geometry via persistent ID, not face index.
- On regen, the kernel re-decorates downstream BReps with persistent IDs based on the same algorithm — IDs survive parameter changes that preserve topology.
- When topology DOES change (e.g., a hole's reference edge no longer exists because the hole moved off the face), the downstream feature errors with "geometry reference lost" and the user re-binds.

Implementation lives in the Python kernel service as a thin layer over OCCT's BRep. Document the scheme in `cad-kernel/NAMING.md` because future-you will need to revisit it.

### 1e. Constraint-graph persistence

Sketch solver stays client-side. But persist the constraint graph (the `SketchConstraint[]` plus the relevant `SketchEntity[]`), not just resolved Cartesian coordinates. Server kernel re-solves on regen using its own PlaneGCS instance (same WASM, served as a Python ctypes binding or a small C++ helper). This unlocks:
- Deterministic regen across clients.
- Future collaboration (server is canonical).
- Server-side validation (kernel rejects feature-tree updates that yield over-constrained sketches).

`sketchDoc` JSONB already carries `entities + constraints` — no schema change needed.

### Exit criteria for Phase 1

- A circle sketch → extrude flow works end-to-end with the kernel service.
- BRep cache hit ratio > 90% on re-open of a recently-edited model.
- Browser memory footprint for a 50-feature model: < 100MB (was unbounded with client-side regen).
- Mesh delta round-trip on a Extrude edit < 500ms on a typical broadband connection.

---

## Phase 2 — Modeling depth (3-6 months)

Per user direction: depth before breadth. After Phase 1, single-part modeling needs to be useful for real parts.

Feature kinds to add to the kernel service + featureTree schema + UI:
- **Cut-Extrude** (subtract a sketched profile from existing body)
- **Revolve** (rotate sketch around axis)
- **Sweep** (drag profile along a path)
- **Loft** (interpolate between two+ profiles)
- **Fillet** (round an edge — first true use of topological naming)
- **Chamfer** (bevel an edge)
- **Draft** (taper face angles for moulding)
- **Shell** (hollow out a body)
- **Linear Pattern, Circular Pattern, Mirror**
- **Hole Wizard** (hole with diameter / depth / counterbore / countersink options)

Each is a new RPC method on the kernel service + a new `Feature` kind in `frontend/src/app/cad/lib/types.ts`. CadQuery has direct methods for most (`cut`, `revolve`, `sweep`, `loft`, `fillet`, `chamfer`, `shell`); for ones CadQuery doesn't fully cover (advanced fillets, variable-section sweep), drop to `OCP` directly.

Reference geometry as a sub-domain:
- **Datum planes** at offsets, through edges, through three points
- **Datum axes** through edges or two points
- **Datum points** at vertices, intersections, or offsets

Sketches need to be hostable on these too (REQ 625 already added face-hosted sketches; extend to datum-derived hosts).

---

## Phases 3-7 — Brief outline

Detailed planning for these happens after Phase 2 ships and we have a real BRep kernel + modeling depth to build on. Sketches of each:

**Phase 3 — Multi-body + advanced sketch.** Multi-body operations (combine, split, save-body-as-part). Advanced sketch entities (b-spline, fit spline, conic, slot, text, equation curve) — most of REQs 598-606 from earlier. Remaining sketch constraints (REQs 590-597, 605-606).

**Phase 4 — Assemblies.** New data model: `DesignAssembly`, `DesignAssemblyInstance` (Part + transform), `DesignAssemblyMate` (constraint between instances). Mate solver runs server-side (3D constraint solver — OCCT has limited support; may need a 3D extension to PlaneGCS or a dedicated lib). Top-down design (sketching in assembly context using inter-part references). BOM tables. Configurations (variants of a part driven by parameter table).

**Phase 5 — Drawings.** Orthographic projection views derived from BRep. Sections, details, breaks. Dimensions with tolerances. GD&T symbology. Title blocks + BOM tables linked back to the assembly. Drawings are a separate document type sharing the kernel for projection compute.

**Phase 6 — Specialty domains.** Sheet metal (flange/bend operations with K-factor unfold). Surface modeling (NURBS surfaces, surface trim/extend/knit/thicken). Basic FEA (link to an external solver — CalculiX or Code_Aster — server-side).

**Phase 7 — I/O + parametrics.** STEP/IGES/STL import/export (OCCT has these built-in). Equations (parameters defined by formulas). Design tables (Excel-driven variants). DWG drawing export.

---

## Critical files / new directories

**New (server-side):**
- `cad-kernel/` (Python, new top-level dir): kernel service, OCCT/CadQuery bindings, JSON-RPC server. `cad-kernel/NAMING.md` documents the topological naming scheme.
- `backend/services/cadStreamService.js`: WebSocket session manager (mirrors `printAgentService.js`).
- `backend/services/cadKernelClient.js`: JSON-RPC client over Unix socket.
- `backend/migrations/<date>-create-design-brep-cache.js`: BRep cache table.

**Heavily modified (frontend):**
- `frontend/src/app/cad/lib/kernel.ts`: deleted.
- `frontend/src/app/cad/lib/featureTree.ts`: `regenerateModel` deleted; replaced by RPC call to server.
- `frontend/src/app/services/cad-kernel.service.ts`: OCCT lazy-load deleted.
- `frontend/src/app/components/cad/cad-viewer/cad-viewer.component.ts`: face map fed by streaming service instead of synchronous regen.
- `frontend/src/app/components/cad/cad-editor/cad-editor.component.ts`: regen triggered via REST + WebSocket session, not in-process effect.

**New (frontend):**
- `frontend/src/app/services/cad-stream.service.ts`: WebSocket client for control + binary mesh frames.

**Kept unchanged (frontend):**
- `frontend/src/app/cad/lib/store.ts`, `solver.ts`, `profile.ts`, `tessellator.ts` (for preview), `picking.ts` (for sketch picking).
- `frontend/src/app/components/cad/cad-sketch-editor/`: sketch UI keeps working as today.
- All client-side selection, multi-select, snap, preview infrastructure built in recent sessions.

---

## Reused patterns / existing code

- **WebSocket session template:** `backend/services/printAgentService.js` (`ws` library, heartbeat, pending-job tracking, `connectedAgents` Map) — copy the skeleton.
- **Multi-table migration template:** `backend/migrations/20260512000000-create-design-cad-models.js` (DesignCADModel + History + permissions seed).
- **Permission middleware:** `backend/middleware/checkPermission.js` — already supports the `cad` resource; assembly + drawing resources are migrations away.
- **Release workflow:** existing draft → review → released on `DesignCADModel` carries over; revisions work the same.
- **Kernel adapter interface:** `frontend/src/app/cad/lib/featureTree.ts:KernelAdapter` is the right shape for an RPC client to slot into. Keep the interface; swap the implementation.

---

## Key risks

1. **Python kernel deploy complexity.** Adds Python to a Node/Postgres stack. One more container, one more SBOM, one more language in CI. Confirm with ops before Phase 0 ships.
2. **OCCT version pinning.** BREP serialization is version-sensitive. Pin exactly; upgrades are migrations (re-derive cache from definitions).
3. **Topological naming.** If we get the algorithm wrong, downstream features lose their references on innocuous parameter changes. Spend the design time in Phase 1.
4. **Latency.** WebSocket round-trip on a slow connection makes editing feel laggy. Solution: predictive client-side preview during gestures (current Phase A path), commit + reconcile with server result on gesture-end.
5. **Memory in Python kernel.** Long sessions can leak. Idle eviction + restart-on-crash + BRep cache rehydration is the answer; design it in Phase 1, don't bolt on later.
6. **The 50-feature ceiling.** Was tessellation cost, not kernel compute. Per-feature BRep + mesh caching (keyed on the input hash) is what actually solves this. Without it, 500-feature models would hit the same wall on the server. The cache is non-optional.

---

## Verification

**Phase 0 spike acceptance:**
- `node scripts/cad-spike.js` (new) spawns the Python kernel, sends a circle profile via JSON-RPC, receives BREP bytes + face meshes, asserts the BREP round-trips through OCCT's deserializer.
- Manual: time a single Extrude operation end-to-end; should be < 200ms cold, < 50ms warm.

**Phase 1 acceptance:**
- Existing `frontend/src/app/cad/lib/kernel.spec.ts` is deleted (the pure-JS kernel goes away). New end-to-end test `backend/tests/__tests__/design/cad-regenerate.test.js` exercises the full cycle: create a model, post a sketch, call regenerate, verify mesh response + BRep cache populated.
- Manual smoke test in the browser:
  1. Create a model, draw a circle, click Extrude, verify cylinder appears (streamed from server).
  2. Edit the extrude distance via context menu, verify only the affected cylinder re-meshes (cache observed in DB).
  3. Re-open the model from scratch (force cache hit), verify < 500ms time-to-render.
  4. Disconnect the kernel service (kill the Python process), verify the API returns a "kernel unavailable" 503 rather than hanging.
- Memory check: 50-feature model in the browser, devtools heap snapshot < 100MB.
- Run the existing `./scripts/run-tests.sh` to confirm no regressions in non-CAD code paths.

**Open before Phase 1 starts:**
- Validate that `opencascade.js` is *removed* from `frontend/package.json` once unused — save the 234MB from `node_modules`.
- Decide whether the Python kernel runs in the same Proxmox VM as Node (simpler) or a separate container (scales independently).
