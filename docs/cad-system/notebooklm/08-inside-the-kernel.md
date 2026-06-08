# Inside the Geometry Kernel

The CAD system's geometry kernel is a standalone Rust binary that wraps the OpenCASCADE (OCCT) industrial B-rep library. It is deliberately stateless — it builds exactly one shape per request and forgets it — communicating with the Node backend over JSON-RPC 2.0 over TCP. This document covers the process architecture, the JSON-RPC protocol and shared type definitions, every supported operation and the OCCT calls behind each one, how the kernel converts exact geometry to triangles, its persistent face-naming scheme, how it classifies surfaces for the assembly solver, what it exports, and the honest build-system footguns.

---

## Why the Kernel is a Separate Process

The kernel runs as its own operating-system process for two distinct reasons.

The first is language. OCCT is a large C++ library. The web backend is Node/JavaScript. Embedding a C++ geometry library inside a Node server is impractical, so the kernel lives in its own process, written in Rust, which can bridge to C++ cleanly.

The second is isolation. Certain degenerate geometry inputs cause OCCT to throw a C++ exception that escapes the Rust bridge and calls `std::terminate`, terminating the process immediately — no catching, no cleanup. If the kernel ran inside the web server, a misbehaving triangle would take the entire website down. As a separate process, the kernel can crash freely. The web app notices the dropped connection, rejects any in-flight calls cleanly, and reconnects on the next request. The crash is contained.

Because the Node backend runs inside Docker and the kernel runs on the host (in the standard dev setup), a Unix domain socket cannot cross the container boundary. TCP can. Both sides set `TCP_NODELAY` to disable Nagle's algorithm, which would otherwise batch small messages and introduce a perceptible stutter on every operation — each geometry request is small and must be sent immediately.

---

## The Wire Protocol: JSON-RPC 2.0 Over TCP

Messages are line-delimited: one JSON object per line, terminated by a newline. Every request carries a `method` name (e.g. `buildExtrude`), a bag of parameters, and an integer `id`. Replies carry the same `id` so they can be matched back to the waiting caller.

The client-side implementation lives in `cadKernelClient.js`. It maintains a single long-lived TCP connection shared by all concurrent requests. Pending calls are stored in a `Map` from id to `{resolve, reject, timeout}`. When a reply arrives, the client looks up its id, clears the timer, and resolves or rejects the waiting promise. Every call is protected by a 30-second timeout by default (the health-check ping uses 4 seconds). When the connection drops, all in-flight promises are rejected immediately with a "disconnected" error rather than left hanging.

### The Health Probe

The editor polls a dedicated HTTP endpoint every few seconds to show whether the geometry engine is online. That endpoint sends a real `ping` down the same TCP connection used for actual geometry work, with a 4-second timeout. The response always returns HTTP 200; the status is in the payload (`online: true` or `online: false`). This tests the actual path that operations use — not a proxy for it. When the kernel goes down, the badge flips within about 8 seconds, the 3D view clears, and an explicit "geometry engine offline" notice appears. When the kernel recovers, the next poll sees it and the model repaints automatically.

The ping itself costs nothing on the kernel side: a single branch in the dispatch table that returns `"ok"` with no geometry or allocation.

### The Supervisor

`cadKernelSupervisor.js` is an optional (off-by-default) process manager. When enabled, it spawns the kernel binary, pipes its logs into the main logs with a `[cad-kernel]` prefix, and restarts it when it dies. Restarts use exponential backoff: 1 s, 2 s, 4 s, doubling to a cap of 30 s. If the kernel runs healthy for 60 seconds, the backoff resets to 1 s, so a one-off crash recovers fast while a crash loop backs off gracefully. The supervisor and the client share only one piece of information — the TCP address, via an environment variable — and are otherwise independent.

---

## Server-Side Dispatch: `server.rs`

`server.rs` is the kernel's entry point and dispatcher. It listens on the TCP socket, reads one line at a time, identifies the method name, and routes to the appropriate handler via `run_handler`. The complete public vocabulary is: `ping`, `buildExtrude`, `buildRevolve`, `buildBoolean`, `buildSweep`, `buildPattern`, `buildShell`, `buildEdgeBlend` (fillet and chamfer), `buildLoft`, `exportStep`, and `exportStl`. Any unknown method name returns a clean "method not found" error.

Every geometry call is wrapped in Rust's `catch_unwind`. If Rust code panics (array out of bounds, etc.), the bodyguard catches it and sends a clean "internal error" response — the connection continues. C++ exceptions that escape the bridge are a different matter: `catch_unwind` does not catch them. For those, an OCCT terminate handler is installed at startup to log what went wrong before the process exits. The kernel dies, but leaves a death note, and the supervisor brings it back.

---

## The Shared Dictionary: `protocol.rs`

`protocol.rs` is the canonical contract between the Rust kernel and the TypeScript frontend. Both sides must agree on every field name; a comment in the file requires that changes to any field be mirrored in the frontend in the same commit. The contract is manual — two copies in two languages — but centralized in one file.

**Core input types:**

- `Point2` — a 2D point (x, y) in sketch space.
- `Plane3` — a 3D plane defined by an origin and three axis directions plus a normal. The y-axis is technically derivable from the normal crossed with the x-axis, but it is sent explicitly to guarantee both sides agree on sign. A discrepancy in sign would silently mirror a sketch.
- `ProfileEdge` — a tagged union describing outline geometry. Variants: `Line` (start, end), `Arc` (center, radius, angles, *and* world-space endpoints as a redundant cross-check), `Circle` (center and radius — a closed loop in one edge, used as a fast path), `Bezier` (list of control points, used for text glyphs).

**Core output types:**

- `FaceMesh` — one per face of the result: flat arrays of positions, normals, and indices (GPU-ready), a face id, a persistent name string, a flat-face flag, the bounding edge ids, and an optional surface classification. Every build operation also returns the raw B-rep blob (base64) for storage and for chaining into subsequent operations.
- `Topology` — the graph of vertices and edges for wireframe rendering, with seam edges removed and tangent edges flagged.
- Multi-body operations (`buildBoolean`, `buildPattern`, `buildShell`, `buildEdgeBlend`) additionally return a list of separate solids, each with its own blob, center of mass, and volume.

The arc carries both its analytic definition (center, radius, start/end angles, sweep direction) and the actual world-space coordinates of its endpoints. The kernel builds the arc from the math, then confirms the endpoints landed where the frontend said — without re-projecting. Belt-and-suspenders: geometry is a domain where small disagreements compound into broken solids.

---

## The Operations

### Extrude (`buildExtrude` → OCCT `MakePrism`)

Extrude pushes a flat profile along a direction to create a solid. A circle becomes a cylinder; a rectangle becomes a box. It is the foundational 3D CAD operation.

The real work happens in `build_profile_face` before `MakePrism` is called. This function handles four cases: a single circle (fast path, face built directly), any Bézier edges (text-glyph path, preserving smooth curves rather than approximating them as many segments), and the general case (polygon with optional arcs and holes).

The general path includes defensive validation before anything touches OCCT: duplicate adjacent points are removed; zero-length edges are rejected; degenerate collinear triples (Y-junctions) are rejected; near-zero-area outlines are rejected. Any of these passed to OCCT would produce a process-terminating C++ exception. The kernel also computes the outline's signed area via the shoelace formula and reverses the edge list if the winding is clockwise — OCCT requires counterclockwise for correct solid orientation. Reversing an arc also swaps its start and end endpoints and flips its sweep direction.

Two-directional extrudes (pushing in both directions from the sketch plane) avoid the naive approach of building two prisms and fusing them, which leaves a ghost internal seam at the sketch plane. Instead, the kernel shifts the start plane back by the negative distance and extrudes the full combined distance in one shot — a single prism with no internal face.

**Note on multi-body composition:** `buildExtrude` returns only the prism for the new feature. It does not fuse anything into a cumulative body. The Node backend is responsible for taking the returned prism and calling `buildBoolean` (Fuse) to merge it into the running body. The kernel is stateless and does not know a cumulative body exists.

### Revolve (`buildRevolve` → OCCT `MakeRevol`)

Revolve spins a profile around an axis. The same `build_profile_face` and hole handling used by extrude applies here.

OCCT has two constructors for revolve. Passing an angle of 360 degrees builds a start face and an end face that coincide geometrically but are separate topological entities, producing a visible seam. Passing no angle tells OCCT the result is fully closed — start and end are the same topological entity, no seam. The kernel checks whether the requested angle is within 0.001 degrees of 360; if so, it uses the no-angle constructor. Partial revolves use the angle constructor, where start and end faces are intentional and correct.

If the revolve fails (e.g., the profile intersects or sits on the axis), the failure is caught and returned as a human-readable error: "this usually means your profile sits on or crosses the axis, or self-intersects."

### Sweep (`buildSweep` → OCCT `MakePipeShell`)

Sweep drags a profile along a path — a chain of line segments and arcs. A circle swept along an arc produces a bent pipe.

OCCT's simpler sweep, `MakePipe`, requires the path to be C1-continuous (no sharp corners). Real paths frequently have hard corners. The kernel uses `MakePipeShell` instead, which handles corners gracefully at the cost of slightly more internal bookkeeping.

If the profile contains holes (e.g., a square with a cutout), the kernel sweeps the hole profile separately into its own tubular solid and subtracts it from the outer sweep using `buildBoolean` (Cut). The vendored binding does not expose a direct compound-face sweep, so this is done manually.

### Boolean (`buildBoolean` → OCCT Fuse/Cut/Common + `UnifySameDomain`)

Boolean combines two solids. Three modes: Fuse (union), Cut (subtract), Common (intersection). This is the mechanism behind SolidWorks-style "Combine."

After the boolean, `UnifySameDomain` is called to merge adjacent coplanar faces that the boolean fragmented. For example, cutting a cylinder through a box splits a flat face into pie-slice sub-faces — all on the same plane, all artifacts of the operation. `UnifySameDomain` merges them back into the original single face.

The kernel then calls `decompose_into_solids` to separate disconnected pieces. A boolean can split a body into multiple disconnected solids (e.g., cutting across a ring produces two arcs). Each piece is returned separately with its own blob, center of mass, and volume. The backend uses these to assign body identities — the largest piece may retain the original body's identity, while smaller pieces become new bodies. If the boolean produces zero pieces (the cut removes everything), the kernel returns an empty list and a clean error message rather than a silent broken body.

### Pattern (`buildPattern`)

Pattern copies a source solid and fuses the copies together. Three transform types: translation (linear array), rotation (circular array), and mirror (reflection). The frontend converts a user intent like "eight bolts in a circle" into a list of concrete rotation angles; the kernel receives the list and applies each transform to make a copy, then fuses sequentially. The original can be included in the fuse or excluded, depending on a flag.

Fusion is sequential (source ∪ copy 1, then that ∪ copy 2, and so on). A balanced tree approach would be faster for very large counts, but for typical patterns (20 copies or fewer) the difference is imperceptible and sequential is simpler to get correct.

### Shell (`buildShell` → OCCT `MakeThickSolidByJoin`)

Shell hollows a solid by removing selected faces and offsetting the remaining surfaces inward to a uniform wall thickness. It is how enclosures and housings are modeled.

Selected faces are identified geometrically: each pick carries a centroid and an outward normal. `match_picked_faces` scores every face in the solid against each pick by centroid distance, with a tolerance scaled to part size. When two faces have nearly coincident centroids (e.g., top and bottom of a thin plate), the normal breaks the tie. Duplicate picks that resolve to the same face are rejected up front, because `MakeThickSolidByJoin` does not tolerate a duplicate face list.

Current limitation: `MakeThickSolidByJoin` applies a single uniform wall thickness. Per-face thickness requires a lower-level OCCT path not yet available in the vendored binding.

If the offset produces an empty result (walls thicker than the geometry supports), the kernel returns "thickness too large for this geometry" rather than a broken or self-intersecting solid.

### Edge Blend: Fillet and Chamfer (`buildEdgeBlend`)

Fillet and chamfer are in one module because their structure is nearly identical — both work by the user picking edges, which are identified geometrically by their two endpoint world-space coordinates.

Edge matching checks both orderings (start-to-start/end-to-end, and start-to-end/end-to-start) and takes whichever pairing is closer. OCCT may record an edge in the opposite direction from what the frontend expects; checking both avoids failing to match an edge purely because the two sides disagree on which endpoint is "first."

**Fillet** rounds a sharp edge into a smooth blend. The radius must fit within the geometry; if not, the result is empty and the kernel returns "this value is too large for the picked edge, or these faces can't be blended."

**Chamfer** cuts a flat bevel. Three modes:
- Equal distance — symmetric 45-degree bevel, same setback on both faces.
- Two distances — asymmetric, specifying a different setback on each adjacent face.
- Distance and angle — setback on one reference face plus an angle, validated to be strictly between 0 and 90 degrees.

For asymmetric modes, the reference face is found by `find_adjacent_faces`, which walks the body to find the faces that share the picked edge and uses the first as the reference.

Across shell, fillet, and chamfer, the failure pattern is uniform: call the operation, check whether the result blob is empty, and if so emit a human-readable sentence rather than a crash or a silent broken body.

---

## From Exact Geometry to Triangles: `shape_io.rs`

Every build operation funnels through `shape_io.rs` at the end. It performs four jobs.

### 1. Serialize the B-Rep

The exact mathematical boundary representation is serialized to bytes for storage and for feeding into subsequent operations. The vendored OCCT binding only exposes "write to a file path," so the kernel writes to a temporary file, reads the bytes back, and deletes the file. Temporary files are named with the process ID plus an ever-incrementing atomic counter so that concurrent requests never collide on the same filename.

### 2. Tessellate (`chord tolerance 0.05`)

OCCT's mesher is called on each face with a chord tolerance of 0.05 mm. Chord tolerance is the maximum gap permitted between a flat triangle and the true curved surface it approximates. At 0.05 mm, curved surfaces look genuinely round at normal zoom without generating excessive triangles.

This exact value (0.05) is also used by the frontend's 2D sketch tessellator. Both sides use the same constant deliberately: the curve visible while sketching and the curve visible after extruding are tessellated to the same fineness, so they agree. The constant is documented as load-bearing.

### 3. Build Clean Topology

The kernel constructs the wireframe graph of vertices and edges. Two categories of edges are handled specially:

**Seam edges** are artifacts of how OCCT represents certain surfaces internally — a cylinder must be "unwrapped" mathematically, creating a seam where the unwrapped edges rejoin. This seam is real to the math but invisible on the physical cylinder. Detection: a seam edge is referenced twice by the same face. Real edges are shared by two different faces. Any edge owned twice by one face is a seam and is discarded.

**Tangent edges** occur where a fillet meets a flat face. The surfaces meet smoothly — no visible crease. The kernel detects tangent edges by checking whether the normals of the two adjacent faces are within about 5 degrees of parallel. These are flagged as tangent; the viewer draws them as faint dashed lines rather than solid lines, so a smooth blend does not appear creased.

Curved edges are shipped as polyline samples along the true curve so the viewer draws one clean curve rather than having neighboring faces each draw a slightly different approximation.

### 4. Decompose into Solids

As covered under boolean operations: disconnected pieces of the result are separated and returned individually.

---

## Persistent Face Naming

Parametric CAD requires that when a model is rebuilt after a parameter change, the system can still find the same face that was picked earlier — so that a fillet applied to an edge survives a change to the box height that caused the entire part to regenerate. OCCT's internal face numbering is meaningless across rebuilds; it shuffles every time the shape is computed.

The kernel names faces by what they are, not by where they land in a list. The structure is `PersistentName`, which records: which feature produced the face, what role it plays in that feature, and a sub-index. The name for the top cap of an extrude feature is encoded as something like `f1-cap_top`, not `face4`. The top cap is always the top cap regardless of OCCT's internal numbering.

**Extrude role assignment** is geometric. Each face's centroid is projected onto the push direction. Centroid at the base (distance ≈ 0) → `cap_bottom`. Centroid at the far end → `cap_top`. In between → `side`. Side faces are sorted by their angle around the part's central axis so that "side 0" always maps to the same physical face across rebuilds even when OCCT's internal order changes.

**Generic role assignment** covers operations without clean semantic roles — boolean results, revolves, sweeps. All faces are sorted by their centroid coordinates (x, then y, then z) and named positionally (`side_0`, `side_1`, etc.). Face centroids move continuously as parameters change, but the sorted order stays stable unless the topology changes (a face appears or disappears). This gives stability under parameter tweaks within a session. Full topological naming — stability across face count changes — is documented as future work rather than claimed as done.

The persistent name string doubles as the face id: `persistentName === faceId`. Picking a face records the string; after a rebuild the kernel produces a face with that same string, and the selection re-binds. This is what allows fillets and shells to survive upstream edits.

### Schema Version

A single integer constant — currently 20 — identifies the naming and output schema. It must be kept identical in two places: the Rust kernel and the backend JavaScript. The backend uses it as a cache-invalidation key: geometry cached under version 19 is stale when the kernel is on version 20 and must be recomputed. Every VCS commit records the kernel and naming version that produced it, providing provenance for historical parts.

### Body Scoping

When a single operation produces multiple disconnected solids (e.g., a boolean cut that splits a body), each solid's faces would otherwise have colliding name strings — both bodies would have their own `side_0`. The backend prefixes every face name and edge id with a body index (`f2#0-f0` for body 0, face `f0` of feature `f2`). This scoping is also applied to topology edge ids; without it, two bodies' local edge numbers would collide on the frontend's edge map, causing phantom wireframe lines to leak between bodies.

---

## Surface Classification for the Assembly Solver

The assembly mate solver needs exact analytic surface parameters — not triangle soup — to align parts coaxially or face-to-face. A cylinder's true axis and radius cannot be reliably recovered by measuring tessellation triangles.

For every face it tessellates, the kernel also queries OCCT's `BRepAdaptor_Surface` class (accessed via FFI) for the surface type. `BRepAdaptor_Surface` was not in the original vendored binding; it was added by forking the Rust-to-OCCT bridge and contributing three files: a C++ header declaring the surface type and its accessors, a Rust/C++ enum agreement for surface type values, and a high-level Rust wrapper.

The classifier records:
- **Plane:** origin point and outward normal.
- **Cylinder:** a point on the axis, the axis direction vector, and the radius.
- Any other surface type (cone, sphere, freeform): no classification recorded.

These values come from OCCT's exact internal surface description, not from measurements of the mesh. They are stable across regenerations — the hole moves, but its axis as a concept stays a clean line. The classification is an optional field on the face mesh: present for planes and cylinders, omitted entirely for everything else (no cost on the wire). The assembly solver picks it up and never touches a triangle.

---

## Export: STEP and STL

Both export operations take a list of body blobs, combine them into an OCCT compound, write to a temporary file via the OCCT writer, and read the bytes back. The temp-file pattern is the same as for serialization — the vendored writers only accept file paths.

**STEP** is the exact-geometry interchange format (curves stay curves). It returns as text and is the format used for CAM software or other CAD tools.

**STL** is the triangle-mesh format used by 3D printers. It returns as binary, which cannot be embedded directly in JSON. The bytes are base64-encoded; the wire field is explicitly named `stlBase64` on both sides to prevent silent field-name drift. An assembly of multiple solids is combined into one OCCT compound; STEP preserves separate products inside the file, while binary STL flattens everything into one undifferentiated triangle mesh (a property of the format, not a limitation of the implementation).

### Frozen Export for Released Parts

When a part revision is released, its geometry blobs are frozen — stored exactly as they were at that moment. Subsequent STEP or STL downloads for that released revision re-serialize the frozen blobs rather than rerunning any kernel operations. The kernel is invoked only for the final "turn these frozen bytes into a STEP file" step.

This matters because the kernel changes over time. Rebuilding a two-year-old released part with a newer kernel might produce subtly different geometry, which is unacceptable for a part that has been approved and manufactured. Freezing guarantees the download is geometrically identical to what was approved, regardless of how many kernel upgrades have happened since.

If the kernel is down when a live (non-released) model is exported, the response is a clean 503 rather than a hang.

### IGES

The vendored OCCT binding includes an IGES reader and writer at the FFI level, and the relevant OCCT library links. However, no kernel operation exposes IGES, and there is no backend route for it. IGES is latent infrastructure — the plumbing exists but there is no faucet. STEP and STL are the only shipped export formats.

---

## Build-System Footguns

**The cxx bridge watches the wrong file.** The Rust-to-C++ bridge (cxx) only triggers a rebuild when the `.rs` file's modification timestamp changes. Each binding is a pair: a `.rs` file and a companion `.hxx` C++ header. Editing only the header leaves the `.rs` timestamp unchanged, so cxx sees "nothing to rebuild." The header change silently has no effect. The fix is to `touch` the `.rs` file after modifying the header so the bridge notices. This is documented explicitly because it costs an afternoon the first time it happens.

**Two rebuild rhythms.** The web app hot-reloads on every save. The kernel is a separate Docker service and must be rebuilt manually when Rust code changes. It is easy to edit kernel code, observe no change in the running system, and forget no rebuild was triggered. The two programs move on different cadences and that difference must be held in mind explicitly.

These are the structural costs of the blast-wall architecture. A separate process in a separate language with a separate build cycle provides crash isolation. The price is that the two halves do not move in lockstep.

---

## Key Points

- The geometry kernel is a stateless standalone Rust binary. It builds one shape per request and forgets it. All model memory (feature tree, cumulative body, history) lives in the Node backend.
- Isolation is the primary reason for a separate process: a C++ exception in OCCT calls `std::terminate` and kills the process; containing the kernel means a geometry crash cannot take down the web server.
- `server.rs` dispatches ten method names; `catch_unwind` catches Rust panics but not C++ exceptions — OCCT aborts are handled by a terminate handler that logs before dying, plus the supervisor which restarts with exponential backoff.
- `protocol.rs` is the canonical shared dictionary. It is maintained manually in two languages; a comment requires field changes to be mirrored in the frontend in the same commit. Redundant fields (the y-axis of a plane, the arc's endpoint coordinates) are sent explicitly to eliminate sign-agreement bugs.
- Every operation validates input before touching OCCT — zero-length edges, degenerate winding, near-zero area — because OCCT does not return errors for these; it aborts.
- Persistent face naming uses descriptive roles ("cap-top of feature f1") rather than OCCT's internal numbering, which changes on every rebuild. Stability under parameter tweaks is provided; stability across topological changes (face count changes) is documented future work.
- Schema version 20 must match in both the Rust kernel and the backend JavaScript simultaneously; it is the cache-invalidation key and the provenance stamp on every VCS commit.
- Surface classification via `BRepAdaptor_Surface` (vendored FFI) provides exact plane normals and cylinder axes/radii from OCCT's analytic description — not measured off triangles — so the assembly mate solver can align parts coaxially without touching the mesh.
- STEP and STL are the only shipped export formats; IGES FFI exists at the bridge level but is not exposed. Released part exports re-serialize frozen geometry blobs rather than recomputing, guaranteeing the download matches what was approved.
- The cxx bridge only notices `.rs` file changes, not `.hxx` changes — touch the paired Rust file after editing a C++ header. The kernel also has its own Docker rebuild cycle independent of the web app's hot reload.
