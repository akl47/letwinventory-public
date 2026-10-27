# Profile

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Profiles and arrangement](../profiles-arrangement.md) ▸ **profile**
> Related: [profiles-arrangement](../profiles-arrangement.md) · [arrangement](./arrangement.md) · [tessellator](./tessellator.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 617 | unapproved | Profile extraction produces typed `ProfileLoop` preserving curve identity |
| 548 | unapproved | Extract a single closed loop from sketch primitives; reject open/multi/no-line sketches |
| 612 | unapproved | Single-circle profile produces a valid extrude profile |
| 621 | unapproved | Multiple independent closed loops in one sketch |

### REQ 617 — Typed ProfileLoop

- **Description:** The profile-extraction algorithm shall produce a typed `ProfileLoop` preserving curve identity — each edge is either a `LineProfileEdge`, `ArcProfileEdge`, `CircleProfileEdge`, or `BezierProfileEdge`.
- **Rationale:** Typed edges allow the kernel to produce one analytic face per edge instead of N faces per tessellated segment, keeping face count low at any profile size.
- **Verification:** `frontend/src/app/cad/lib/profile.spec.ts` — closed loop, open chain rejection, multi-loop, single-circle, arc-mixed.
- **Validation:** An extruded rectangle has exactly 6 faces, not hundreds of tessellated facets.

---

## Succinct description

`profile.ts` extracts closed 2D profiles from a sketch state. It classifies the sketch into one or more `ProfileLoop` arrays (each loop is a typed edge list), and groups nested loops into `ProfileRegion` records (outer boundary + hole list) for use by the extrude feature.

---

## How it works — for everyone (non-technical)

Before the 3D engine can extrude a sketch into a solid, it needs to know exactly which closed outlines to push. The profile extractor walks the sketch's lines and arcs to find every closed loop. A loop might be a simple rectangle, a circle, or a complex shape with arcs and lines mixed together. If a loop encloses another (like a circle inside a square), the extractor figures out that the inner loop is a hole in the outer region. Each loop is described not as a list of tiny dots but as real geometric curves, so the kernel can build smooth faces.

---

## How it works — in detail (technical)

### Data types

```
ProfileEdge = LineProfileEdge | ArcProfileEdge | CircleProfileEdge | BezierProfileEdge
ProfileLoop = ProfileEdge[]
ProfileRegion = { outer: ProfileLoop; holes: ProfileLoop[] }
```

`tessellateProfileLoop(loop, chordTolerance?)` converts a typed loop back to a flat `Point2[]` polyline for closure checking or containment tests.

### Single-loop extraction (`extractClosedLoop`)

1. Filters out construction entities.
2. Single-circle shortcut (REQ 612): if the sketch contains exactly one non-construction `circle` and no lines/arcs, returns `[{ kind: 'circle', ... }]`.
3. Builds an adjacency map of non-construction line/arc segments by shared endpoint ids.
4. Validates: any point with degree 1 = open chain; degree >2 = branch point; reports the error.
5. Walks the adjacency graph from `segments[0]` to build `pointWalk` and `segmentWalk` arrays. For arcs walked in reverse, the `ccw` flag is inverted.
6. Returns an array of `LineProfileEdge` and `ArcProfileEdge` objects with resolved 2D coordinates.

### Multi-loop extraction (`extractClosedLoops`)

1. Collects text glyph outlines via `bezierLoopsFromTextEntity` (emits `BezierProfileEdge` chains — one per character contour). Single-line engraving font is skipped.
2. Calls `splitAtIntersections(state)` to cut curves at all pairwise crossings (circles become arcs; lines get interior split-points inserted).
3. Non-construction circles that survived splitting unchanged (< 2 crossings) become standalone `[{ kind: 'circle' }]` loops.
4. Runs the DCEL face-walker (`extractArrangementFaces`) on the split state. Bounded faces (positive signed area, ≥ 2 edges) each become one `ProfileLoop` via `faceToProfileLoop`.

### Region detection (`extractRegions`)

1. Calls `extractClosedLoops`.
2. Pre-tessellates each loop at tolerance `1.0` for containment testing.
3. Builds a containment matrix: `insideOf[i]` = set of loop indices that fully contain loop `i` (all vertices of `i` inside `j`).
4. Finds each loop's direct parent (the deepest container) and assigns it as the outer with all direct children as holes.
5. Returns `{ regions, errors }` where each region maps to an `ExtrudeFeature.regionIndices` entry.

`topLevelRegionIndices(state)` returns only the outermost loops (not contained in any other) — used to auto-select text character regions for extrusion.

---

## Key files

- `frontend/src/app/cad/lib/profile.ts` — extraction logic
- `frontend/src/app/cad/lib/profile.spec.ts` — unit tests
- `frontend/src/app/cad/lib/arrangement.ts` — DCEL face extraction (dependency)
