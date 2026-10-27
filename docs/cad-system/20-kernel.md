# Geometry Kernel (Rust / OCCT)

> **System** ▸ [Overview](./00-overview.md) ▸ **Kernel**
> Feature-group docs: [kernel/](./kernel/00-overview.md) · Related: [CAD Modeler](./10-cad-modeler.md) · [Assembly](./40-assembly.md)

---

## Requirements

The kernel is the geometric engine behind the CAD features. Its directly-defining requirements:

| REQ | Status | Summary |
|-----|--------|---------|
| 549 | unapproved | Extrude (profile + distance → solid) |
| 662 | unapproved | Combine (boolean between bodies) |
| 658 | unapproved | Pattern features (linear/circular/mirror) |
| 659 | unapproved | Shell (hollow by removing faces) |
| 642 | unapproved | Fillet (edge blend) |
| 643 | unapproved | Chamfer (bevel, three modes) |
| 517 | unapproved | Stable per-face identifiers across regeneration |
| 723 | unapproved | STL via `exportStl`, STEP via `exportStep` |
| 749 | unapproved | Per-face surface classification (plane/cylinder) |

### REQ 749 — Surface classification

- **Description:** For each planar or cylindrical face it emits, the CAD kernel shall include a surface classification giving the geometry needed to position mates — a plane's origin and normal, or a cylinder's axis and radius.
- **Rationale:** The assembly mate solver constrains *surfaces* (coincident planes, concentric cylinders); it needs analytic surface data, not just a triangle mesh.
- **Verification:** A cylindrical face returns a stable axis direction and radius across regenerations; a planar face returns origin + normal.
- **Validation:** A user mates a bolt shaft concentric to a hole and the solver uses the kernel-emitted cylinder axes.

### REQ 517 — Persistent face names

- **Description:** The CAD module shall assign each face of a rendered solid a unique identifier that remains constant for the life of the feature that produced it.
- **Rationale:** Selections, fillet/chamfer edge picks, and diff coloring must survive regeneration; positional indices are unstable.
- **Verification:** Pick a face, edit an unrelated parameter, regenerate, confirm the selection still resolves.
- **Validation:** A fillet placed on a face survives edits to upstream features.

---

## Succinct description

A standalone Rust service wrapping the OpenCASCADE (OCCT) B-rep kernel. It receives JSON-RPC build requests (extrude, boolean, revolve, sweep, pattern, shell, edge-blend, export), produces boundary-representation solids, tessellates them into `FaceMesh` arrays with stable per-face persistent names and plane/cylinder surface classification, and serializes BReps for freeze/export.

---

## How it works — for everyone (non-technical)

The kernel is a dedicated calculator for solid shapes, kept in its own program because the math is heavy and specialized. The rest of the system never does geometry itself — it sends the kernel a small instruction like "take this outline and push it 10 mm" or "round these edges with a 2 mm radius," and the kernel sends back the finished 3D shape as a web of triangles the browser can draw.

It's built on OpenCASCADE, the same industrial-strength geometry library used by professional CAD tools, and it's written in Rust for speed and safety. Two things make it more than a dumb calculator: it labels every surface with a permanent name so the system can remember "you picked *this* face" even after the shape rebuilds, and it tells the assembly tools whether each surface is flat or round (and where its axis is), which is exactly what's needed to line parts up.

---

## How it works — in detail (technical)

### Process and protocol

The kernel runs as a separate process; the backend talks to it via line-delimited JSON-RPC 2.0 over TCP (`cadKernelClient.js` ↔ `server.rs`). `cadKernelSupervisor.js` monitors health and respawns on crash; a lightweight ping powers the editor's kernel-availability probe (REQ 744).

```mermaid
flowchart LR
  REGEN["cadRegenService /\nassemblyRegenService"] -->|JSON-RPC request| SRV["server.rs\n(dispatch by method)"]
  SRV --> OP["ops/*.rs\n(extrude, boolean, revolve,\nsweep, pattern, shell, edge_blend)"]
  OP --> OCCT[("OCCT B-rep")]
  OCCT --> IO["shape_io.rs\n(tessellate + classify + name)"]
  IO -->|FaceMesh[] + topology + base64 BREP| SRV
  SRV -->|JSON-RPC response| REGEN
```

`protocol.rs` defines the shared request/response types — `Point2`, `Plane3`, `ProfileEdge`, `PatternTransform`, `FaceMesh`, `Topology`, `FaceSurface` — mirroring the frontend/backend TypeScript/JS shapes so the same vocabulary crosses every boundary.

### Operations

Each op (`cad-kernel/src/ops/`) maps a request to OCCT calls:

- **extrude** — `BRepPrimAPI_MakePrism` from a typed profile + host plane; line/arc/circle/Bézier edges; analytic arcs via 3-point construction; returns the prism BRep (the backend composes into the cumulative body via `buildBoolean`).
- **boolean** — Fuse / Cut / Common on base64-deserialized BReps; `ShapeUpgrade_UnifySameDomain` clean; per-solid `SolidPart` decomposition.
- **revolve** — `BRepPrimAPI_MakeRevol` from profile + world-space axis; full revolve uses the no-angle constructor (closed surface, no seam).
- **sweep** — `BRepOffsetAPI_MakePipeShell` from profile + path; handles sharp-cornered paths (unlike C1-only `MakePipe`).
- **pattern** — applies `PatternTransform[]` (translate/rotate/mirror), fuses copies into a combined body; `decompose_into_solids` for body tracking.
- **shell** — `BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin`; faces matched geometrically (centroid + normal); C++ shim validates with `BRepCheck_Analyzer`, rejecting malformed-but-`IsDone` results.
- **edge_blend** — fillet (`BRepFilletAPI_MakeFillet`, radius) / chamfer (`BRepFilletAPI_MakeChamfer`, three modes: equal distance, two-distance, distance-angle); edges matched by world-space endpoints.
- **export** — STEP (`STEPControl_Writer`) and STL (`StlAPI_Writer`, base64) only; IGES is not a registered RPC method.

See [kernel/operations](./kernel/operations.md), [export](./kernel/export-step-iges-stl.md).

### Tessellation, naming, surface classification

`shape_io.rs` is the output stage:

- **Tessellation** — `BRepMesh` triangulates each face to a `FaceMesh` (positions, per-vertex normals, indices) at chord tolerance 0.05, matching the frontend tessellator so sketch-side and solid-side polylines agree.
- **Persistent naming** (`naming.rs`) — each face/edge carries a schema-versioned `PersistentName` (feature id, role, sub-index, upstream refs) that survives regeneration (REQ 517). `cadRegenService` rewrites raw kernel names like `f2-f0` into body-scoped `f2#0-f0`.
- **Surface classification** (REQ 749) — a `BRepAdaptor_Surface` FFI binding (vendored into the `opencascade-rs` bridge: `geom_abs.{rs,hxx}`, `b_rep_adaptor.{rs,hxx}`, `primitives/face.rs`) emits a per-face `surface` field: plane `{origin, normal}` or cylinder `{axis, radius}`. This is consumed by the mate solver.

See [kernel/shape-io-tessellation](./kernel/shape-io-tessellation.md), [persistent-naming](./kernel/persistent-naming.md), [surface-classification](./kernel/surface-classification.md).

### Build note

The kernel is a separate Docker service (`letwinventory-cad-kernel`). The cxx bridge only rebuilds on `.rs` mtime changes (not paired `.hxx`); kernel rebuilds are run by the maintainer, not automatically.

---

## Key files

- `cad-kernel/src/server.rs` — JSON-RPC server + dispatch
- `cad-kernel/src/protocol.rs` — shared request/response types (incl. `FaceSurface`)
- `cad-kernel/src/ops/{extrude,boolean,revolve,sweep,pattern,shell,edge_blend,shape_io,export}.rs`
- `cad-kernel/src/naming.rs` — persistent naming
- vendored `opencascade-rs` bridge: `geom_abs.{rs,hxx}`, `b_rep_adaptor.{rs,hxx}`, `primitives/face.rs`
- `backend/services/cadKernelClient.js`, `cadKernelSupervisor.js` — process client + supervisor
