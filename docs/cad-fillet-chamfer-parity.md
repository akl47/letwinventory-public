# CAD Fillet/Chamfer — SolidWorks parity status

_Last reviewed: 2026-05-27_

Tracks remaining work to reach feature-parity with SolidWorks' Fillet
and Chamfer commands. Phase 1 lands in this branch (commit on
`cad`); subsequent phases get their own sessions.

## Legend
- **✓** Implemented and shippable.
- **▲** Partial — data type or basic case exists, refinement needed.
- **✗** Not implemented.
- **Backend** column: F (frontend only), K (kernel work), V (vendored
  opencascade-rs wrapper required).

## Fillet (Round) modes

| Mode | Status | Backend | Notes / source |
|---|---|---|---|
| Constant radius, single edge | ✓ | F+K | `body.fillet_edges(r, [edge])` |
| Constant radius, multiple edges | ✓ | F+K | Same call, edge list |
| Per-edge radius (mixed radii in one feature) | ▲ | K | opencascade-rs `add_edge(r, edge)` already accepts per-edge; protocol + UI need extension. **Phase 1.** |
| Tangent edge propagation toggle | ▲ | F | Frontend computes tangent-continuous neighbors from topology + `is_tangent` flag. **Phase 1.** |
| Variable radius (per-vertex control points along edge) | ✗ | F | `variable_fillet_edges((t, r) pairs)` already exists; needs UI + protocol. **Phase 2.** |
| Asymmetric fillet (different radii on two sides) | ✗ | V | OCCT `BRepFilletAPI_MakeFillet::Add(R1, R2, edge)` overload not exposed in opencascade-rs. **Phase 3.** |
| Face fillet (between two faces, no edge) | ✗ | V | OCCT `BRepFilletAPI_MakeFillet::Add(face1, face2)` not exposed. **Phase 3.** |
| Full round fillet (three adjacent faces) | ✗ | V | Same family as Face fillet. **Phase 3.** |
| Setback fillet (special handling at vertices) | ✗ | V | OCCT `BRepFilletAPI_MakeFillet::SetFilletShape(SetBack)`. **Phase 4.** |
| Conic / elliptical cross-section | ✗ | V | OCCT `BRepFilletAPI_MakeFillet::SetFilletShape(Rational)` + ratio. **Phase 4.** |
| Hold line | ✗ | V | OCCT `BRepOffsetAPI_MakeOffset` + projection logic. **Phase 4.** |

## Chamfer (Bevel) modes

| Mode | Status | Backend | Notes / source |
|---|---|---|---|
| Equal distance (45°), single edge | ✓ | F+K | `body.chamfer_edges(d, [edge])` |
| Equal distance, multiple edges | ✓ | F+K | Same call, edge list |
| Per-edge distance (mixed distances) | ▲ | K | Protocol + UI extension. **Phase 1.** |
| Tangent edge propagation toggle | ▲ | F | Same propagation logic as fillet. **Phase 1.** |
| Asymmetric distance-distance | ✓ | F+K+V | `chamfer_edges_two_distance` wrapper added to vendored opencascade-rs; kernel `ChamferMode::TwoDistance` picks the first adjacent face as the reference. |
| Angle-distance | ✓ | F+K+V | `chamfer_edges_distance_angle` wrapper added to vendored opencascade-rs; kernel `ChamferMode::DistanceAngle` converts degrees → radians before OCCT call. |
| Vertex chamfer (3 distances at a vertex) | ✗ | V | OCCT `BRepFilletAPI_MakeChamfer` doesn't support; need a different path. **Phase 3.** |
| Offset face chamfer | ✗ | V | Distances measured along face surface. **Phase 3.** |
| Face-face chamfer | ✗ | V | Same family as Face fillet. **Phase 3.** |

## Frontend polish

| Item | Status | Notes |
|---|---|---|
| Clean preview overlay (thin tube highlight) | ✓ | Single bright tube along each picked edge; replaced misleading fake-fillet tube + arbitrary-perp chamfer offset lines. |
| Tangent-edge-style render for fillet boundaries | ✓ | `is_tangent` flag drives lighter-dashed material. |
| Per-edge value column in sidebar edge list | ✗ | **Phase 1.** |
| Preview shows actual fillet boundary on adjacent faces | ✗ | Requires face↔edge adjacency lookup. **Phase 2.** |
| Sidebar "tangent propagation" toggle button | ✗ | **Phase 1.** |
| Sidebar "keep features" toggle | ✗ | OCCT `MakeFillet::SetContinuity`. **Phase 4.** |

## Phase plan

### Phase 1 (this session, branch `cad`)
- Preview overlay rebuilt as a single thin-tube highlight per edge. ✓
- Frontend: tangent-edge propagation toggle. Walks the topology-edge
  graph from each picked edge, BFS through tangent-continuous neighbors
  (parallel tangent directions at shared endpoints).
- Frontend: per-edge value override column in the fillet/chamfer
  sidebar. Defaults to the global value; user can override per-row.
- Kernel + protocol: `EdgeRef.value?: number` override; kernel passes
  per-edge radius/distance through `MakeFillet::add_edge` / `MakeChamfer::add_edge` calls.

### Phase 2
- Variable-radius fillet UI (control points along a single edge).
- Asymmetric chamfer + angle-distance chamfer:
  1. Add wrappers in vendored `opencascade-rs` for `MakeChamfer::Add(d1, d2, edge, face)`
     and `MakeChamfer::AddDA(d, angle, edge, face)`. These need a face
     reference, so we extend `EdgeRef` to optionally name the reference
     face's id.
  2. Kernel routes `chamfer-asymmetric` / `chamfer-angle-distance` modes
     to the new wrappers.
- Preview overlay: render the actual fillet boundary curve on each adjacent face
  (offset along face perpendicular by `value`).

### Phase 3
- Face fillet / face-face chamfer / vertex chamfer / full round fillet.
- Each needs a new opencascade-rs wrapper + a different UI surface
  (face picker instead of edge picker for most of these).

### Phase 4
- Setback fillets, conic / hold-line fillets, special continuity options.
- Niche features; defer until users ask.
