# protocol.rs — Wire types and JSON-RPC envelope

> **System** ▸ [Overview](../../00-overview.md) ▸ [Kernel](../../20-kernel.md) ▸ [RPC server & protocol](../rpc-server-protocol.md) ▸ **protocol.rs**
> Related: [server.md](./server.md) · [ops-extrude.md](./ops-extrude.md) · [surface-ffi.md](./surface-ffi.md)

---

## Requirements

Governed by [RPC server & protocol](../rpc-server-protocol.md) and [Operations](../operations.md). The field names in this file are deliberately kept in sync with the TypeScript types in `frontend/src/app/cad/lib/profile.ts` and `types.ts`.

| REQ | Status | Summary |
|-----|--------|---------|
| 749 | unapproved | Per-face surface classification (plane/cylinder) for assembly mate solver |

### REQ 749 — Surface classification wire shape

- **Description:** For each planar or cylindrical face it emits, the CAD kernel shall include a surface classification giving the geometry needed to position mates — a plane's origin and normal, or a cylinder's axis and radius.
- **Rationale:** The assembly mate solver constrains surfaces (coincident planes, concentric cylinders); it needs analytic surface data, not just a triangle mesh.
- **Verification:** A cylindrical face returns a stable axis direction and radius across regenerations; a planar face returns origin + normal.
- **Validation:** A user mates a bolt shaft concentric to a hole and the solver uses the kernel-emitted cylinder axes.

---

## Succinct description

`protocol.rs` defines every Rust struct that crosses the JSON-RPC wire: the envelope types (`RpcRequest`, `RpcResponse`, `RpcBody`, `RpcError`), the five standard error codes, and all per-operation parameter and result types.

## How it works — for everyone (non-technical)

This file is a shared dictionary. Both the sender (Node backend) and the receiver (Rust kernel) agree that "buildExtrude" takes a certain set of fields and returns a certain set of fields. `protocol.rs` writes that agreement down in Rust's type system. If a field name ever changes here, the frontend must be updated in the same commit — the module comment says exactly that.

## How it works — in detail (technical)

### Envelope types

```
RpcRequest  { jsonrpc: String, id: Option<Value>, method: String, params: Value }
RpcResponse { jsonrpc: &'static str, id: Value, body: RpcBody }
RpcBody     = Ok { result: Value } | Err { error: RpcError }   (serde untagged)
RpcError    { code: i32, message: String, data: Option<Value> }
```

`RpcBody` uses `#[serde(untagged)]` so the two variants serialize as `{"result":…}` and `{"error":…}` directly inside the response object — the JSON-RPC 2.0 wire shape.

### Shared geometry primitives

`Point2 { x, y }` and `Plane3 { origin, xAxis, yAxis, normal }` (all `[f64; 3]`) are shared across extrude, revolve, and sweep. `Plane3.yAxis` is accepted from the wire but unused server-side (OCCT derives it from `normal × xAxis`); it's carried to avoid sign disagreements if recomputed.

### ProfileEdge — typed profile loop

```
enum ProfileEdge (tag = "kind"):
  Line   { start: Point2, end: Point2 }
  Arc    { center, radius, startAngle, endAngle, ccw, start, end }
  Circle { center: Point2, radius: f64 }
  Bezier { points: Vec<Point2> }
```

`Arc` carries redundant `start`/`end` world coords alongside the analytic center/radius/angles so the extrude builder can verify endpoints without re-projecting. `Circle` is the single-edge closed-loop fast path (REQ 612). `Bezier` supports glyph (text) outlines.

### FaceMesh and Topology

`FaceMesh` is the per-face tessellation result:

```
FaceMesh {
  faceId, persistentName: String,
  isFlat: bool,
  positions: Vec<f32>,   // flat xyz triples
  normals:   Vec<f32>,   // flat xyz triples, aligned with positions
  indices:   Vec<u32>,
  boundaryEdgeIds: Vec<String>,   // omitted when empty
  surface: Option<FaceSurface>,   // plane/cylinder classification
}
```

`FaceSurface` (REQ 749):

```
FaceSurface { kind: "plane"|"cylinder", origin, normal?, axis?, radius? }
```

`Topology` is the edge/vertex graph accompanying each result:

```
Topology {
  vertices: [{ id, position: [f64;3] }],
  edges:    [{ id, isStraight, isTangent?, endpoints, polyline? }]
}
```

`isTangent` is omitted when false for backwards compat; `polyline` is omitted for straight edges.

### Per-operation parameter/result types

| Request struct | Result struct | Notes |
|---|---|---|
| `BuildExtrudeParams` | `BuildExtrudeResult` | includes `direction2?: {distance, kind}`, `startOffset`, `flipped` |
| `BuildBooleanParams` | `BuildBooleanResult` | `op: fuse/cut/common`; result has `solids: Vec<SolidPart>` |
| `BuildEdgeBlendParams` | `BuildEdgeBlendResult` | `kind: fillet/chamfer`; three `ChamferMode` variants |
| `BuildRevolveParams` | `BuildRevolveResult` | `angleDeg`, world-space `axisOrigin`/`axisDir` |
| `BuildSweepParams` | `BuildSweepResult` | `pathEdges: Vec<PathEdge>` (world-space line/arc/circle) |
| `BuildShellParams` | `BuildShellResult` | faces identified by `centroid + normal` |
| `BuildPatternParams` | `BuildPatternResult` | `transforms: Vec<PatternTransform>`, `mergeWithSource` |
| `BuildLoftParams` | `BuildExtrudeResult` | `sections: Vec<LoftSection>` (reuses extrude result type) |
| `ExportStepParams` | `ExportStepResult` | `breps: Vec<String>` (base64); result has `step: String` |
| `ExportStlParams` | `ExportStlResult` | `tolerance: f64`; result has `stlBase64: String` |

`SolidPart` appears in boolean / edge-blend / shell / pattern results for multi-body tracking:
```
SolidPart { brepBytes, centroid: [f64;3], volume: f64, faces, topology }
```

## Key files

- `cad-kernel/src/protocol.rs` — this module (all wire types)
- `frontend/src/app/cad/lib/profile.ts` — TypeScript counterpart for `ProfileEdge`
- `frontend/src/app/cad/lib/types.ts` — TypeScript counterpart for feature/result types
