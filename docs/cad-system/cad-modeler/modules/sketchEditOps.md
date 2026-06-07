# sketchEditOps

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **sketchEditOps**
> Related: [Sketching](../sketching.md) · [store](./store.md) · [arrangement](./arrangement.md)

---

## Requirements

Requirements are governed by [Sketching](../sketching.md).

There are no individual REQs for Trim/Extend/Split/Mirror/Offset specifically; these are implementation of the sketch editing surface described by REQ 521 and the sketcher tool set.

---

## Succinct description

`sketchEditOps.ts` exports pure functions for the six sketch editing operations: Trim, Extend, Split, Mirror, Offset, and chained offset. Each takes a `SketchState` and operation-specific parameters and returns a new `SketchState` (plus an `OpResult` with affected IDs and optional error text). None mutate state directly.

---

## How it works — for everyone (non-technical)

These are the editing tools you use after drawing shapes: Trim cuts away the part of a line or arc between two intersections (like scissors cutting between marks on a ruler). Extend stretches a line to the nearest boundary. Split cuts a line at a point, turning one line into two. Mirror copies selected shapes to the other side of a centerline and adds symmetry constraints. Offset creates a parallel copy of a curve at a given distance. All these tools work by computing new points and entities and swapping them in — the original sketch state is never modified.

---

## How it works — in detail (technical)

### Shared `OpResult`

```typescript
interface OpResult {
  state: SketchState;
  error?: string;
  affectedIds?: string[];
  constructionLineIds?: string[];
}
```

### Trim (`trimAt`, `previewTrimLine`, `previewTrimCircle`, `previewTrimArc`)

`trimAt(state, entityId, clickPoint)` dispatches to `trimLine`, `trimCircle`, or `trimArc`.

**`trimLine`:** Collects all hit parameters `t ∈ (0,1)` where other non-construction curves cross the line (`collectLineHits`). Finds the two hits bracketing `tClick` (nearest left/right). Calls `splitLineKeepingOnly` to replace the original line with one or two sub-segments. Each new sub-segment:
- Gets direction-class constraints (horizontal/vertical/parallel/perpendicular/collinear/angle/on-edge) inherited from the original
- Gets coincident constraints pinning its new endpoints to the intersected curve

**`trimCircle`:** Finds crossing angles, brackets the click angle, deletes the circle, and emits a replacement arc covering the kept arc (from `nextHit` to `prevHit` CCW). Constraints on the circle are rewired to the new arc via `inheritConstraintsOntoEntity`.

**`trimArc`:** Same as trimCircle but operates within the arc's existing sweep. Keeps up to two sub-arcs (one on each side of the click). Inherits constraints onto the first surviving arc.

**Constraint inheritance:** Direction constraints (`isDirectionConstraint`) and `on-edge` links transfer to every sub-segment via `inheritConstraintsOntoMultiple`. Dimensional constraints (length, equal) are intentionally not inherited since the sub-segment has a different length.

**Endpoint reuse (`acquireOrCreatePoint`):** Before creating a new sub-segment endpoint, the function searches for an existing point within `1e-3` units. Reusing avoids spawning redundant coincident constraints for T-junctions where the cutter's endpoint already sits at the intersection.

### Extend (`extendLine`, `previewExtendLine`)

Picks the endpoint of the target line closest to `clickPoint`. Finds all intersection candidates with other curves beyond that endpoint. Moves or replaces the endpoint (depending on whether it is shared with other geometry) and adds a `coincident` constraint pinning it to the boundary entity.

### Split (`splitLineAt`)

Projects `clickPoint` onto the line; creates a new midpoint and replaces the original line with two sub-lines. Construction lines are rejected.

### Mirror (`mirrorEntities`)

For each entity in `entityIds`:
- `line`: reflects both endpoints via `reflectAcrossLine` from `geometry.ts`, creates a mirrored line, records point pairs
- `circle`: reflects center, emits an equal-radius constraint
- `arc`: reflects center/start/end, flips `ccw`, emits an equal-radius constraint
- `point`: reflects and records the pair

After all entities are mirrored, emits `symmetric(orig, mirror, axis)` constraints for each point pair and `equal` constraints for each curve pair. This wires the mirror to the originals so dragging the original moves the mirror symmetrically.

### Offset (`offsetCurve`)

For a line: determines side via cross product, translates both endpoints perpendicular by `distance * sign`. For a circle: outward if cursor is outside, inward if inside; adjusts radius. For an arc: scales start/end points radially; preserves `ccw`.

### Chained offset (`propagateOffsetSides`, `findChainedEntities`, `flipSidePoint`)

`findChainedEntities(state, startId)` BFS-floods the sketch by shared endpoint coordinates (not IDs) to find all segments connected to the seed. `propagateOffsetSides` then determines the consistent offset direction for the whole chain:
- **Closed loop:** uses `_polygonContains` to test whether each offset's midpoint is on the same side (inside/outside) as the seed click.
- **Open chain:** propagates the seed's left/right handedness relative to chain-traversal direction through each segment.

`groupAndOrderChains` partitions an `OffsetChainItem[]` into connected components and orders each component from one open end.

---

## Key files

- `frontend/src/app/cad/lib/sketchEditOps.ts` — all editing operations
- `frontend/src/app/cad/lib/geometry.ts` — intersection and reflection math
