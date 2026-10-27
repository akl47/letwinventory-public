# cadProjection — Convert-Entities Re-Projector

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadProjection**
> Related: [cadRegenService](./cadRegenService.md)

---

## Requirements

Requirements: governed by [Regeneration Pipeline](../regen-pipeline.md). No dedicated REQ for this module; it is an internal correctness mechanism ensuring that "Convert Entities" sketch links track their source edges at regen time.

---

## Succinct description

`cadProjection.js` re-projects Convert-Entities sketch links at the start of each feature's regen step. It walks every `on-edge` constraint in every sketch and updates each linked entity's coordinates to match the current position of the referenced body edge, so the kernel always sees live-projected geometry rather than coordinates that were persisted when the source feature last had different parameters.

## How it works — for everyone (non-technical)

SolidWorks' "Convert Entities" tool lets you trace the outline of an existing face onto a new sketch — the traced lines stay glued to the face. When you change the upstream feature (say, a different extrude distance), the traced lines need to move with it. This module does that update on the server side so the kernel receives the correct (current) sketch coordinates, matching what the browser editor shows.

## How it works — in detail (technical)

### Export

```javascript
module.exports = { applyProjectionToSketchDoc };
```

### `applyProjectionToSketchDoc(sketchDoc, bodies, opts?) → sketchDoc`

Returns a new `sketchDoc` (or the same reference if nothing changed). Never mutates input.

**Edge index construction.** Builds a `Map<edgeId, edge>` from every body's `topology.edges`. Edge ids are globally unique after the per-body topology scoping in `cadRegenService` (`_scopeTopology`).

**Per-sketch pass.** For each sketch:

1. Finds all `on-edge` constraints (type `'on-edge'`, non-null `externalRef.edgeId`). Each target entity id in `c.targets` becomes a `(entity, edgeId)` pair.
2. Legacy fallback: entities carrying a `projectedFrom.edgeId` field (pre-constraint-migration format) are treated as on-edge equivalents.
3. For each pair, looks up the source edge. If not found (edge was deleted upstream), the entity is left unchanged.

**Per-entity update by kind:**

| Entity kind | Source edge shape | Update |
|---|---|---|
| `line` | `isStraight: true`, `endpoints: [[x,y,z],[x,y,z]]` | Projects both endpoints to sketch-plane 2D via `_projectFrom3D`. Proximity-based assignment swaps start↔end if `|start→ep2| + |end→ep1| < |start→ep1| + |end→ep2|` — handles kernel reordering endpoints between regens. |
| `circle` | `polyline: [...]` (closed circular) | Fits a center + radius from the 2D-projected polyline via `_circleFromPolyline` (centroid + mean radius). |
| `arc` | `polyline: [...]` (open arc) | Fits center/radius/endpoints/ccw via `_arcFromPolyline` (three-point circumcircle from first/mid/last sample). Includes the same proximity-based start↔end swap, and flips `ccw` accordingly. |

**Pinned-point guard.** Points already constrained by `coincident`, `fixed`, or `midpoint` constraints skip re-projection — user-applied constraints always win over source-edge tracking.

**CAD_DEBUG=1** logs each moved point with before/after coords.

### Helper: `_projectFrom3D(plane, world) → {x, y}`

Subtracts `plane.origin` and dot-products against `plane.xAxis` and `plane.yAxis` to convert a world-space `[x,y,z]` position into sketch-plane 2D coordinates.

---

## Key files

- `backend/services/cadProjection.js` — this module
- `backend/services/cadRegenService.js` — calls `applyProjectionToSketchDoc(sketchDoc, bodies)` per feature iteration
