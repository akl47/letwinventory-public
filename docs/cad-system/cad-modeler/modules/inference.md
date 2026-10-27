# Inference

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **inference**
> Related: [Sketching](../sketching.md) · [Constraints](../constraints.md) · [solver](./solver.md)

---

## Requirements

Requirements are governed by [Sketching](../sketching.md) · [Constraints](../constraints.md).

There is no dedicated REQ for the inference engine; it supports REQ 524 (horizontal/vertical constraints) and REQ 543 (point-on-line snap) as part of the tool interaction flow.

---

## Succinct description

`inference.ts` provides pure functions that, given a cursor position during tool placement, return a snapped coordinate and a pending constraint to apply on commit. It implements horizontal/vertical snap, polar tracking, curve-coincidence snap, and alignment guides — without touching sketch state.

---

## How it works — for everyone (non-technical)

When you are drawing a line and your mouse gets close to horizontal, the line "snaps" to perfectly horizontal and a small badge says "horizontal". If you hover near an existing circle, the endpoint snaps onto the circle and will stay constrained to it. The inference engine is the part that detects these situations and suggests the snap + the constraint to add automatically. It never applies the constraint itself — that only happens when you actually click.

---

## How it works — in detail (technical)

### `inferLineEnd(state, start, cursor): InferenceResult`

Called on every mouse-move during line drawing, with the first endpoint already committed. Priority order (first match wins):

1. **Curve coincidence.** `nearestCurveHit` scans non-construction lines, arcs, and circles within `LINE_SNAP_TOL = 2` sketch units. For lines it projects `cursor` onto the segment; for circles/arcs it projects onto the circumference (arcs additionally check whether the projection lies within the sweep). Skips endpoint touches (within 1 unit) — those are handled by the editor's coincident-point-reuse. Returns the snapped point and a `coincident` `PendingConstraint`. If the hit is on a LINE and the new line would be horizontal/vertical to `start`, the snap is further adjusted to the exact H/V intersection and a second constraint is pushed.

2. **Horizontal snap.** If `|dy/dx| < tan(ANGLE_SNAP_TOL = 5°)`, snaps `end.y = start.y` and returns a `horizontal` constraint.

3. **Vertical snap.** If `|dx/dy| < tan(ANGLE_SNAP_TOL)`, snaps `end.x = start.x` and returns a `vertical` constraint.

4. **Polar tracking.** `polarSnap` finds the nearest multiple of `POLAR_STEP = 15°` within `POLAR_TOL = 3°` of the current cursor angle from `start`. Projects the cursor onto the polar ray. Returns the snapped point with a degree-label hint (e.g. `"45°"`) and a dashed guide line, but **no constraint** — polar angles aren't represented as PlaneGCS primitives.

5. **Alignment snap.** `alignmentSnap` scans all existing sketch points for vertical or horizontal alignment with the cursor within `ALIGN_TOL = 1.5` sketch units. Returns the snapped point and a dashed guide, but no constraint.

### `inferHoverOnCurve(state, cursor)`

Pre-first-click hover: detects whether the cursor is near a curve and returns the set of hint labels to display as badges (`'on line'`, `'vertical'`, `'horizontal'`, `'on arc'`, `'on circle'`). Uses `nearestCurveHit` with the same `LINE_SNAP_TOL`.

### `InferenceResult` shape

```typescript
{
  snapped: { x, y };          // adjusted cursor coords
  constraint: PendingConstraint | null;   // primary constraint (back-compat)
  constraints?: PendingConstraint[];      // all constraints that fired
  hint: string | null;                    // primary badge label
  hints?: string[];                       // all badge labels
  guides?: Array<{ from, to }>;           // dashed alignment lines
}
```

### `PendingConstraint` targets

- `{ self: true }` — refers to the entity being drawn (resolved to its ID by the editor after creation)
- `{ entityId: string }` — an existing entity
- `{ pointIndex: number }` — the Nth point of the new entity (0 = start, 1 = end)

### Exported constants

`ANGLE_SNAP_TOL`, `LINE_SNAP_TOL`, `POLAR_STEP`, `POLAR_TOL`, `ALIGN_TOL` — all in radians or sketch units as indicated.

---

## Key files

- `frontend/src/app/cad/lib/inference.ts` — all inference logic
