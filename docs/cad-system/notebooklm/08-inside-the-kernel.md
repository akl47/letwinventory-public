# Inside the Geometry Kernel

The CAD system's geometry kernel is a standalone native C++ program built directly on the OpenCASCADE (OCCT) 8.0 industrial B-rep library. It is deliberately stateless — it builds exactly one shape per request and forgets it — communicating with the Node backend over JSON-RPC 2.0 over TCP. This document covers the process architecture and its history (the kernel was originally written in Rust and rewritten in C++), the wire protocol, the operation vocabulary and the OCCT calls behind it, how the kernel converts exact geometry to triangles, its persistent face-naming scheme, how it classifies surfaces for the assembly solver, what it exports, and the resilience machinery that keeps a crash-prone problem domain from taking anything else down with it.

---

## Why the Kernel is a Separate Process

The kernel runs as its own operating-system process for two distinct reasons.

The first is language. OCCT is a large C++ library. The web backend is Node/JavaScript. Embedding a C++ geometry library inside a Node server is impractical, so the kernel lives in its own process, in its own language, behind a socket.

The second is isolation. Certain degenerate geometry inputs cause OCCT to fail unrecoverably — in the worst case terminating the process immediately, with no catching and no cleanup. If the kernel ran inside the web server, a misbehaving triangle would take the entire website down. As a separate process, the kernel can crash freely. The web app notices the dropped connection, rejects any in-flight calls cleanly, and reconnects on the next request. The crash is contained.

Because the Node backend runs inside Docker, the two processes talk over TCP rather than a Unix socket — TCP crosses the container boundary. The connection is long-lived and shared by all concurrent requests, and messages are small and sent immediately, so per-operation latency stays low.

### From Rust to Native C++

The kernel's first implementation was written in Rust, reaching into OCCT through a vendored Rust-to-C++ FFI bridge. It worked, and it shipped the system's first year of geometry. But the bridge was a permanent tax: every OCCT class the kernel needed had to be individually declared through the binding layer (adding surface classification meant forking the bridge and contributing three files), the bridge's build system had a notorious footgun where editing a C++ header without touching its paired Rust file silently skipped the rebuild, and OCCT capabilities the vendored binding did not expose were simply unreachable.

The current kernel, in `cad-kernel-cpp/`, is native C++ — the same language as OCCT itself. There is no bridge. Any of OCCT's thousands of classes is one `#include` away. The wire protocol was kept byte-compatible during the rewrite, so the backend, the cache, and the frontend did not change; the old and new kernels answered the same requests with the same JSON. That protocol-level swap is the strongest practical evidence for the system's "replaceable engine" claim. (The old Rust tree still exists in the repository as a reference; the C++ kernel is the one the backend talks to.)

The kernel identifies itself on every health check: `ping` returns a build marker (a hand-bumped string like `cpp-12`), the naming-schema version, and the exact OCCT version it was compiled against. The backend uses these to refuse cooperating with a stale binary.

---

## The Wire Protocol: JSON-RPC 2.0 Over TCP

Messages are line-delimited: one JSON object per line, terminated by a newline. Every request carries a `method` name (e.g. `buildExtrude`), a bag of parameters, and an integer `id`. Replies carry the same `id` so they can be matched back to the waiting caller. The default listen address is `127.0.0.1:9876`, overridable by environment variable.

The client-side implementation lives in `cadKernelClient.js`. It maintains a single long-lived TCP connection shared by all concurrent requests. Pending calls are stored in a `Map` from id to `{resolve, reject, timeout}`. When a reply arrives, the client looks up its id, clears the timer, and resolves or rejects the waiting promise. Every call is protected by a 30-second timeout by default (the health-check ping uses 4 seconds). When the connection drops, all in-flight promises are rejected immediately with a "disconnected" error rather than left hanging.

The wire contract itself — every field name in every request and response — is maintained by hand on both sides: the C++ serializers and the JavaScript client must agree exactly, and changes must land on both sides in the same commit. Redundant fields are sent deliberately where a sign disagreement would be silent and catastrophic: a plane carries its y-axis explicitly even though it is derivable from the normal and x-axis, and an arc carries both its analytic definition (center, radius, angles, sweep direction) and the world-space coordinates of its endpoints as a cross-check. Geometry is a domain where small disagreements compound into broken solids; belt-and-suspenders is the correct posture.

### The Health Probe

The editor polls a dedicated HTTP endpoint every few seconds to show whether the geometry engine is online. That endpoint sends a real `ping` down the same TCP path used for actual geometry work, with a 4-second timeout. The response always returns HTTP 200; the status is in the payload (`online: true` or `online: false`). This tests the actual path that operations use — not a proxy for it. When the kernel goes down, the badge flips within about 8 seconds; when it recovers, the next poll sees it and the model repaints automatically.

The ping also carries the kernel's naming-schema version, and the regeneration service checks it before every regeneration: if the running kernel's schema version does not match the backend's constant, regeneration refuses to run. This is the guard against the single most insidious failure mode — a stale kernel binary quietly writing incompatibly-named geometry into the content-addressed cache.

### Server Threading

The server is thread-per-connection: each TCP connection gets its own handler thread. The practical payoff is that a `ping` on its own connection stays responsive even while a heavy build operation is churning on another — the health badge does not lie during long operations.

---

## Dispatch and the Three-Layer Blast Wall

`main.cpp` is the kernel's entry point. Its dispatcher, `handle_method`, routes each request by method name. The complete public vocabulary is: `ping`, `buildExtrude`, `buildRevolve`, `buildSweep`, `buildLoft`, `buildBoolean`, `buildFuseMany`, `buildShell`, `buildEdgeBlend` (fillet and chamfer), `buildPattern`, `buildFeaturePattern`, `buildToolPattern`, `bodyVolume`, `exportStep`, and `exportStl`. Any unknown method name returns a clean "method not found" error.

Failure handling is layered by failure mode:

**Layer one — reject what can be detected.** Every operation validates its input before touching OCCT: degenerate outlines, zero-length edges, duplicate points, near-zero areas. Handlers throw C++ exceptions for anything they can detect, and the server converts those into clean JSON-RPC errors with human-readable messages. An explicit empty-result guard runs after boolean operations: if OCCT produces a shape that cannot even be serialized ("likely degenerate input — e.g. a cut that produces zero volume"), the caller gets a sentence, not a corrupt blob.

**Layer two — restart what dies.** Some OCCT failures abort the process outright. The kernel runs under Docker with `restart: unless-stopped`, so a dead process is replaced by a fresh one within seconds. The in-flight request fails with a disconnect error; the client reconnects on the next call.

**Layer three — execute what hangs.** The most insidious OCCT failure is the infinite loop: an operation that neither returns nor crashes. There is no way to cancel a hung C++ computation from the outside of the thread, so the kernel does not try. A detached watchdog thread polls once per second; each operation handler arms a per-operation deadline on entry (default 60 seconds, configurable via `CAD_KERNEL_OP_TIMEOUT_MS`). If any operation outlives its deadline, the watchdog calls `std::_Exit` — deliberate process suicide — and layer two's restart machinery brings back a clean kernel. The blunt instrument is the correct instrument: a process that might be wedged is worth less than a fresh one.

The cost of layer three is honest: watchdog suicide kills the whole process, so concurrent requests on other connections die with the hung one. For this system's request volumes that trade is acceptable; the alternative — a permanently wedged kernel that still accepts connections — is worse.

Every operation also logs a per-operation timing lap to stderr, so a slow regeneration can be decomposed into exactly which kernel calls cost what.

---

## The Operations

### Extrude (`buildExtrude` → OCCT `MakePrism`)

Extrude pushes a flat profile along a direction to create a solid. The real work happens in profile-face construction before the prism is swept: a single circle takes a fast path; Bézier edges (text glyphs) preserve smooth curves; the general case builds a polygon with optional arcs and holes. Defensive validation runs first — duplicate adjacent points removed, zero-length edges rejected, degenerate collinear triples rejected, near-zero-area outlines rejected — because these are exactly the inputs that make OCCT abort rather than return an error. The kernel computes the outline's signed area via the shoelace formula and reverses clockwise windings; OCCT requires counterclockwise for correct solid orientation, and reversing an arc also swaps its endpoints and flips its sweep direction.

Two-directional extrudes avoid building two prisms and fusing them (which leaves a ghost internal seam at the sketch plane): the start plane is shifted back and a single full-length prism is built in one shot.

Up-to-body and up-to-next end conditions are resolved inside the kernel: the backend sends the target bodies' exact solids, and the kernel derives the cap surface from them rather than trusting a pre-computed distance.

**Note on multi-body composition:** `buildExtrude` returns only the prism for the new feature. It does not fuse anything into a cumulative body. The Node backend is responsible for composing the returned prism into the running body via boolean operations. The kernel is stateless and does not know a cumulative body exists.

### Revolve (`buildRevolve` → OCCT `MakeRevol`)

Revolve spins a profile around an axis. OCCT has two constructors: passing an angle of 360 degrees builds coincident-but-separate start and end faces, producing a visible seam; passing no angle tells OCCT the result is fully closed. The kernel checks whether the requested angle is within a hair of 360 and uses the seamless constructor when it is. If the revolve fails (profile intersects or sits on the axis), the failure comes back as a human-readable sentence.

### Sweep (`buildSweep` → OCCT `MakePipeShell`)

Sweep drags a profile along a path of line segments and arcs. OCCT's simpler `MakePipe` requires a corner-free path; real paths have hard corners constantly, so the kernel uses `MakePipeShell`, which handles them. Profiles with holes are swept as separate tubes and subtracted.

### Loft (`buildLoft`)

Loft interpolates a solid through an ordered sequence of cross-section profiles on different planes — square-to-circle transitions, blade profiles. Verified against the live kernel as part of the 3D feature test-case catalog.

### Boolean (`buildBoolean` → OCCT Fuse/Cut/Common + `UnifySameDomain`)

Boolean combines two solids: Fuse (union), Cut (subtract), Common (intersect). After the boolean, a cleanup pass (`clean_unify`) runs `ShapeUpgrade_UnifySameDomain` to merge the co-planar face fragments the boolean introduced — cutting a cylinder through a box splits a flat face into pie slices that should read as one face again.

The cleanup pass carries a hard-won validity guard. For one specific configuration — two coaxial cylindrical faces with *opposite* axis directions, which arises when a bore is extended by a coaxial same-diameter cut — `UnifySameDomain` corrupts the solid rather than merging the faces, leaving it flagged unorientable and breaking every downstream fillet and boolean. The guard checks the result with `BRepCheck_Analyzer` and refuses to return a solid that is *worse* than its input: if the unified result is invalid but the input was valid, the input wins. The two coaxial faces then remain two faces in the exact geometry, and the visual seam between them is suppressed at the tessellation layer so the bore wall *reads* as one face on screen. Honest limitation: downstream operations still see two faces in the B-rep.

The kernel then decomposes the result into disconnected solids — a cut can split a body into pieces — and returns each with its own blob, center of mass, and volume. Zero pieces (the cut removed everything) returns an empty list and a clean error rather than a silent broken body.

### Fuse-Many (`buildFuseMany`)

A multi-region feature (extruding the nine letters of an engraved word) used to fuse its prisms pairwise — eight sequential boolean calls, each re-parsing and re-serializing the growing result. `buildFuseMany` performs the same fuse as a single OCCT operation with one base and a compound tool. Crucially, it names the result's faces identically to what the legacy pairwise chain would have produced, so persistent face names — and therefore every downstream reference and cache entry — are unchanged. The backend detects older kernels that lack the method and falls back to the pairwise chain.

Boolean-family operations also accept a `wantFaces` parameter: `"all"` (tessellate the top-level result and each solid) or `"solids"` (per-solid only), which halves meshing work for the composition pipeline that only consumes per-solid faces.

### Pattern (`buildPattern`, `buildFeaturePattern`, `buildToolPattern`)

`buildPattern` copies a source solid by a list of transforms — translations (linear array), rotations (circular array), or mirror reflections — and fuses the copies. The frontend converts user intent ("eight bolts in a circle") into concrete transforms; the kernel applies them.

`buildFeaturePattern` and `buildToolPattern` implement *true* feature patterns: rather than copying finished geometry, they re-execute the seed operation at each pattern location (the tool variant patterns the cutting tool and applies it in a single boolean pass). This is what lets a patterned up-to-next cut adapt to different local geometry at each copy.

### Shell (`buildShell` → OCCT `MakeThickSolidByJoin`)

Shell hollows a solid by removing selected faces and offsetting the remaining surfaces inward to a uniform wall thickness. Selected faces are identified geometrically — each pick carries a centroid and an outward normal; candidates are scored by centroid distance with the normal as tiebreaker for thin plates. Duplicate picks resolving to the same face are rejected up front because the OCCT operation does not tolerate them. An offset that produces an empty result (walls thicker than the geometry supports) returns "thickness too large for this geometry" rather than a self-intersecting solid.

### Edge Blend: Fillet and Chamfer (`buildEdgeBlend`)

Fillet and chamfer share one operation because their structure is nearly identical: the user picks edges, identified geometrically by their two endpoint world-space coordinates. Edge matching checks both endpoint orderings and takes the closer pairing, because OCCT may record an edge in the opposite direction from what the frontend expects.

**Fillet** rounds an edge into a smooth blend; a radius that does not fit returns a clean error. A **full-round fillet** variant takes three face sets and replaces the center face with a blend dictated by the flanking faces. **Chamfer** cuts a flat bevel in three modes: equal distance, two distances, and distance-plus-angle (validated strictly between 0 and 90 degrees). Across shell, fillet, and chamfer the failure pattern is uniform: run the operation, check for an empty result, and emit a human-readable sentence rather than a crash or a silent broken body.

### Volume (`bodyVolume`)

Returns the exact volume of a body from OCCT's analytic mass properties — not integrated from the triangle mesh, which systematically under-counts curved faces by the chord tolerance. The editor's mass readout uses this number.

---

## From Exact Geometry to Triangles

Every build operation funnels through the shared geometry-I/O layer (`geom_io.cpp`) at the end. It performs four jobs.

### 1. Serialize the B-Rep

The exact mathematical boundary representation is serialized to bytes (shipped as base64 in the JSON reply) for storage and for feeding into subsequent operations. Serialization of an empty or broken shape throws — this is the empty-BRep guard the boolean operations lean on.

### 2. Tessellate (chord tolerance 0.05)

The whole result shape is meshed once, in parallel, by a single OCCT mesher invocation (`ensure_meshed`) with a chord tolerance of 0.05 mm — the maximum gap permitted between a flat triangle and the true curved surface. Meshing the whole shape at once, rather than face-by-face, has two virtues: OCCT parallelizes it across cores, and shared edges are discretized exactly once, so the mesh is watertight — adjacent faces agree about where their common edge lies. (An earlier design meshed each face sequentially; on a complex part that was 165 separate mesher invocations.) The call is idempotent — already-meshed shapes are not re-meshed.

The 0.05 value is deliberately identical to the chord tolerance used by the frontend's 2D sketch tessellator, so the curve visible while sketching and the curve visible after extruding agree to the same fraction of a millimeter.

### 3. Build Clean Topology

The kernel constructs the wireframe graph of vertices and edges. Two edge categories get special handling. **Seam edges** — artifacts of OCCT's internal unwrapping of closed surfaces like cylinders — are detected (an edge referenced twice by the same face is a seam) and discarded. **Tangent edges** — where a fillet meets a flat face smoothly — are detected by comparing adjacent face normals (within about 5 degrees of parallel) and flagged, so the viewer draws them as faint dashed lines rather than hard creases. The same tangent-edge suppression is what visually heals the coaxial-cylinder case that `UnifySameDomain` cannot merge. Curved edges ship as polyline samples along the true curve so neighboring faces do not each draw a slightly different approximation.

### 4. Decompose into Solids

Disconnected pieces of the result are separated and returned individually, each with its own B-rep blob, center of mass, and volume, so the backend can assign body identities.

---

## Persistent Face Naming

Parametric CAD requires that when a model is rebuilt after a parameter change, the system can still find the same face that was picked earlier — so a fillet applied to an edge survives a change to the box height that regenerated the entire part. OCCT's internal face numbering is meaningless across rebuilds; it shuffles every time.

The kernel names faces by what they are, not by where they land in a list. Each name records which feature produced the face, what role it plays, and a sub-index — serialized with guaranteed field order so the same identity always produces the same string. The top cap of an extrude is `cap-top` of that feature, not "face four."

**Extrude role assignment** is geometric: each face's centroid is projected onto the push direction — at the base → `cap-bottom`, at the far end → `cap-top`, between → `side`. Side faces are sorted by angle around the central axis so "side 0" maps to the same physical face across rebuilds.

**Generic role assignment** covers operations without clean semantic roles — booleans, revolves, sweeps. Faces are sorted by centroid coordinates and named positionally. Centroids move continuously as parameters change, so the sorted order stays stable under parameter tweaks — but it is honest to call this what it is: *positional* naming, stable within a topology, not true topological naming that survives face-count changes. That distinction is the documented frontier: it is why downstream features keep geometric-snapshot fallbacks for their picks, and it is the blocker for reusing per-face meshes across regenerations.

The persistent name string doubles as the face id. Picking a face records the string; after a rebuild the kernel produces a face with the same string, and the selection re-binds.

### Schema Version and Body Scoping

A single integer constant — the naming schema version, currently 45 — identifies the naming and output format. It is defined identically in the C++ kernel and the backend JavaScript, with an instruction to bump both together. The backend uses it three ways: as a cache-invalidation key (rows written under version 44 stop matching), as provenance stamped on every VCS commit, and as the runtime handshake check that refuses to regenerate against a mismatched kernel binary. The build marker (`cpp-12`) moves independently of the schema version — a tessellation-only improvement bumps the build without invalidating the cache.

When one operation produces multiple disconnected solids, each solid's faces are scoped with a body suffix so names do not collide across bodies (`f2#0` vs `f2#body1` style scoping), and the backend further prefixes edge and vertex ids per scope — without this, two bodies' local edge numbers collide in the frontend's edge map and phantom wireframe lines leak between bodies.

---

## Surface Classification for the Assembly Solver

The assembly mate solver needs exact analytic surface parameters — not triangle soup — to align parts coaxially or face-to-face. A cylinder's true axis cannot be reliably recovered from tessellation triangles.

For every face it tessellates, the kernel queries OCCT's surface adaptor for the face's true surface type. Planes get their origin point and outward normal recorded; cylinders get a point on the axis, the axis direction, and the radius. These come from OCCT's exact internal surface description, not from mesh measurements, and they are stable across regenerations. Other surface types (cones, spheres, freeform) are left unclassified — nothing downstream consumes them yet, and the field simply stays absent on the wire.

In the Rust era, reaching the surface adaptor meant forking the FFI bridge and contributing new binding files. In native C++ it is an include and a call — a concrete illustration of what the rewrite bought.

---

## Export: STEP and STL

Both export operations take a list of body blobs, combine them into an OCCT compound, and run the appropriate OCCT writer. **STEP** is the exact-geometry interchange format (curves stay curves), returned as text, used for CAM and other CAD tools. **STL** is the triangle-mesh format for 3D printing, returned as binary and base64-encoded for the JSON wire (the field is explicitly named `stlBase64` on both sides to prevent silent drift). STEP preserves separate products inside the file; binary STL flattens everything into one undifferentiated mesh — a property of the format.

**Frozen export for released parts:** when a revision is released, its geometry blobs are frozen. Subsequent STEP or STL downloads re-serialize the frozen blobs; the kernel is invoked only to transcode already-decided bytes into a file format. Rebuilding a two-year-old part with a newer kernel could produce subtly different geometry — unacceptable for an approved, manufactured revision. If the kernel is down when a live model is exported, the response is a clean 503 rather than a hang.

---

## Build-System Footguns

**Two rebuild rhythms.** The web app hot-reloads on every save. The kernel is a separate Docker image and must be rebuilt manually when C++ code changes. It is easy to edit kernel code, observe no change in the running system, and forget no rebuild was triggered. Two defenses exist: the `ping` payload reports the hand-bumped build marker, so "which binary is actually running" is one health check away; and the naming-schema handshake hard-stops regeneration when the running kernel's schema disagrees with the backend's — the stale-binary case that used to *corrupt the cache* now fails loudly instead.

**The retired Rust footgun.** The old kernel's FFI bridge only rebuilt when the `.rs` file's timestamp changed; editing only the paired C++ header silently did nothing. That an afternoon-eating trap was eliminated wholesale by the rewrite is part of why the rewrite happened.

**OCCT compile times.** OCCT is enormous, and the kernel's Docker build compiles it from source. The build is layered so the compiled OCCT layer caches and only the kernel's own sources rebuild on a normal change — but invalidating that cache layer is expensive.

These are the structural costs of the blast-wall architecture: a separate process in a separate language with a separate build cycle provides crash isolation, and the price is that the two halves do not move in lockstep.

---

## Key Points

- The geometry kernel is a stateless standalone native C++ binary on OCCT 8.0. It builds one shape per request and forgets it. All model memory (feature tree, cumulative body, history) lives in the Node backend.
- It was originally a Rust wrapper over an FFI bridge into OCCT; the rewrite to native C++ removed the bridge (and its rebuild footgun) while keeping the wire protocol byte-compatible, so nothing else in the system changed — the strongest evidence that the "replaceable engine" boundary is real.
- The blast wall has three layers matched to three failure modes: validate-and-reject what can be detected (with human-readable errors), Docker-restart what aborts, and watchdog-kill what hangs (per-operation deadline, default 60 s, then deliberate process exit so the restart can happen).
- The dispatcher serves fifteen methods, including `buildFuseMany` (N-way fuse in one boolean, named identically to the pairwise chain it replaces), true feature patterns (`buildFeaturePattern`/`buildToolPattern` re-execute the operation per copy), and exact `bodyVolume`.
- Every operation validates input before touching OCCT — zero-length edges, degenerate winding, near-zero area — because OCCT does not return errors for these; it aborts.
- `clean_unify` merges boolean-fragmented coplanar faces but guards its own output with `BRepCheck_Analyzer` and never returns a solid worse than its input; the coaxial opposite-axis cylinder case that OCCT cannot merge is visually healed by dropping the tangent seam while the B-rep honestly keeps two faces.
- Tessellation is one parallel whole-shape mesher pass at 0.05 mm chord tolerance — watertight because shared edges are discretized once — replacing an earlier sequential per-face design.
- Persistent face naming is role-based for extrudes (`cap-top`, `cap-bottom`, sorted `side`s) and centroid-sorted positional for everything else; stability under parameter tweaks is provided, but true topological naming across face-count changes remains the documented frontier.
- Naming schema version 45 must match in the C++ kernel and the backend simultaneously; it is the cache-invalidation key, the provenance stamp on every VCS commit, and a runtime handshake that refuses regeneration against a mismatched binary. The build marker (`cpp-12`) moves independently for output-compatible changes.
- Surface classification (exact plane normals, cylinder axes and radii, straight from OCCT's analytic description) feeds the assembly mate solver; in C++ this is a direct API call rather than the Rust era's forked-binding ceremony.
- STEP and STL are the shipped export formats; released-part exports re-serialize frozen geometry blobs, with the kernel acting only as a format transcoder.
