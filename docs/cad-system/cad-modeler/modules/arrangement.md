# Arrangement

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Profiles and arrangement](../profiles-arrangement.md) ▸ **arrangement**
> Related: [profiles-arrangement](../profiles-arrangement.md) · [profile](./profile.md)

---

## Requirements

Requirements are governed by [Profiles and arrangement](../profiles-arrangement.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 621 | unapproved | Multiple independent closed loops detected via region (arrangement) detection |

---

## Succinct description

`arrangement.ts` implements a planar arrangement: it splits every non-construction sketch curve at every pairwise intersection, then builds a DCEL (doubly-connected edge list) and enumerates all bounded faces via the "always turn left" walk. `profile.ts` uses this to discover every closed region in a sketch, including regions created by overlapping or intersecting curves.

---

## How it works — for everyone (non-technical)

When you draw two overlapping circles, or a line cutting through a circle, you get regions that aren't directly described by any single shape. This module finds all such regions automatically. It works like a city-map planner: first it marks every intersection (every point where two curves cross), then it builds a network of one-way streets along the curve segments between intersections, and finally it walks that network to enumerate every enclosed city block (closed region).

---

## How it works — in detail (technical)

### Phase 1 — `splitAtIntersections(state)`

**Canonicalize coincident points.** The sketch editor creates separate point IDs for each segment endpoint and links them via `coincident` constraints (not shared IDs). `canonicalizePoints` merges coincident-constrained points to a single canonical ID so the adjacency graph has correct degree at every vertex.

**Gather curves.** Non-construction lines, circles, and arcs are collected into typed `Curve` descriptors (`LineCurve`, `CircleCurve`, `ArcCurve`).

**Pairwise intersection.** Every curve pair is intersected via `intersectCurves`, which dispatches to `lineLineIntersection`, `lineCircleIntersection`, or `circleCircleIntersection` from `geometry.ts`. Hits are accepted only when they are interior to both curves (not at an existing shared endpoint). A spatial-bucket map (key resolution = `1/POINT_TOL = 1e4`) deduplicates close hits and reuses existing point IDs when a hit lands near an existing endpoint.

**Output.** The function returns a new `SketchState` where:
- circles with ≥ 2 interior hits are replaced by a sequence of `arr_ar_N` arcs (CCW, sharing the intersection points)
- circles with fewer than 2 hits pass through unchanged
- lines are split into `arr_ln_N` sub-segments at each hit parameter (sorted by `t ∈ [0,1]`)
- arcs are similarly split, with hits sorted by sweep offset in the arc's direction
- constraints are dropped (not relevant to face extraction)

### Phase 2 — DCEL and face walk

**`buildHalfEdges(state)`** creates a pair of directed half-edges for every non-construction line and arc in the post-split state. Each `HalfEdge` carries:
- `fromId` / `toId` (point ids)
- `twinId` (the reverse half-edge)
- `exitAngle` — tangent direction at `fromId`, computed analytically: `atan2(dy, dx)` for lines; `atan2(±cos θ, ∓sin θ)` for arcs depending on CCW flag

**`extractArrangementFaces(state)`** builds the face list:
1. Groups half-edges by `fromId`.
2. At each vertex, sorts the outgoing half-edges by `exitAngle`.
3. The "next" half-edge for a given half-edge `e` is the one immediately clockwise after `twin(e)` in the sorted list at `e.toId` — the standard DCEL "next-around-face" rule.
4. Follows next-pointers to enumerate faces. Each face's signed area (shoelace formula) distinguishes bounded interiors (positive) from the unbounded outer face (negative or zero).

```mermaid
flowchart LR
    A[SketchState] --> B[canonicalizePoints]
    B --> C[gatherCurves]
    C --> D[pairwise intersection]
    D --> E[splitAtIntersections output]
    E --> F[buildHalfEdges]
    F --> G[sort by exitAngle at each vertex]
    G --> H[walk next-pointers]
    H --> I[ArrangementFace list]
```

### Exported types

- `ArrangementFace { edges: HalfEdge[]; signedArea: number }` — one face boundary
- `HalfEdge { id, fromId, toId, twinId, kind, from?, to?, arcCenter?, arcRadius?, arcCcw?, arcStartAngle?, arcEndAngle?, exitAngle }` — one directed edge
- `splitAtIntersections(state): SketchState`
- `buildHalfEdges(state): HalfEdge[]`
- `extractArrangementFaces(state): ArrangementFace[]`

---

## Key files

- `frontend/src/app/cad/lib/arrangement.ts` — all arrangement logic
- `frontend/src/app/cad/lib/geometry.ts` — `lineLineIntersection`, `lineCircleIntersection`, `circleCircleIntersection` (dependencies)
