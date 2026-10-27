# Store

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **store**
> Related: [types](./types.md) · [solver](./solver.md) · [Sketching](../sketching.md)

---

## Requirements

Requirements are governed by [Sketching](../sketching.md) · [Constraints](../constraints.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 522 | unapproved | Create a sketch point at a user-specified 2D location |
| 523 | unapproved | Create a sketch line segment between two endpoints |
| 530 | unapproved | Delete entity with cascading constraint and support-point removal |
| 566 | unapproved | Circle (center + radius) tool |
| 569 | unapproved | Arc (center + endpoints) tool |

---

## Succinct description

`store.ts` exports pure functions that produce new `SketchState` values from old ones. Every mutation — adding entities, adding constraints, deleting, merging points, toggling construction — is an immutable transformation that returns a fresh state object.

---

## How it works — for everyone (non-technical)

The store is the sketch's memory. Instead of changing things in place, every edit creates a brand new copy of the sketch with the change applied. This design makes undo/redo trivial (just keep old copies), prevents one part of the code from accidentally affecting another, and makes testing easy. You hand in the current sketch and a description of the change; you get back the updated sketch.

---

## How it works — in detail (technical)

### ID generation

`nextId(prefix)` produces a locally-unique string combining a monotonic counter, a `Date.now()` base-36 fragment, and a short random suffix. New IDs are **not** globally unique UUIDs; REQ 742 requires globally unique IDs for VCS-addressable entities — the editor supplies those via a separate `randomId()` helper before calling store functions.

### Primitive creation helpers

| Export | Creates |
|--------|---------|
| `addPoint(state, x, y)` | `PointEntity` |
| `addLine(state, startId, endId, opts?)` | `LineEntity` (optional `construction`) |
| `addCircle(state, cx, cy, radius)` | center `PointEntity` + `CircleEntity` |
| `addCircleByPoint(state, centerId, radius)` | `CircleEntity` reusing existing center point |
| `addArc(state, cx, cy, sx, sy, ex, ey, ccw)` | 3 `PointEntity` + `ArcEntity`; end point snapped to radius |
| `addArcByPoints(state, centerId, startId, endId, ccw)` | `ArcEntity` reusing existing points |
| `addEllipse(state, ...)` | center + majorAxisEnd `PointEntity` + `EllipseEntity` |
| `addSpline(state, controlPoints, degree)` | N `PointEntity` + `SplineEntity` |
| `addSplineByPoints(state, controlPointIds, degree)` | `SplineEntity` referencing existing points |

Composite builders decompose user-facing shapes into underlying primitives:

- `addRectangleCorners` — 4 points + 4 lines + horizontal/perpendicular/parallel auto-constraints
- `addRectangleCenter` — same as corners plus a construction diagonal + midpoint constraint pinning the center
- `addPolygon` — N equally-spaced points + N lines
- `addSlotStraight` / `addSlotStraightCenterpoint` / `addSlotArc3Pt` / `addSlotArcCenterpoint` — side lines + semicircular caps as arcs
- `addCircle3Points` / `addArc3Points` — circumcenter computation via `circumcenter()`

### The arc end-point invariant

`addArc` projects the raw end-click onto the circle of `|center→start|` radius before storing it. This keeps `|center→start| == |center→end| == radius` as a guaranteed invariant that the renderer, picker, and tessellator all rely on.

### Deletion cascade (`deletePrimitive`)

`deletePrimitive(state, id)` iterates to a fixed point:

1. Forward pass: any entity whose support points include a doomed id is also doomed.
2. Backward pass: a doomed entity's support points are doomed unless another surviving entity or position-determining constraint still references them.

The origin point (`ORIGIN_POINT_ID = 'origin'`) is exempt from cascade and cannot be deleted. All constraints whose targets reference any doomed entity are also removed.

### Constraint management

`addConstraint(state, type, targets, value?, placement?)` wraps target ids in `ConstraintTarget` objects (REQ 561). `removeConstraint` filters by id. `setConstraintValue` / `setDistanceValue` update a dimensional constraint's value immutably.

### Point merging (`mergePoints`)

`mergePoints(state, keepId, dropId)` rewrites every entity reference from `dropId` to `keepId`, then drops the `dropId` entity and any self-referential constraints that result (e.g., `coincident(P, P)` after both targets collapse to the same id).

### Construction flag (`setConstructionFlag`)

Toggling a curve's construction flag also cascades to its support points so the visual state stays coherent (dashed point = reference-only marker, same as dashed curve).

### Origin constants

`ORIGIN_POINT_ID = 'origin'` and `ORIGIN_POINT` are exported so the solver and determinacy analyzer can identify the synthetic sketch origin without querying state.

---

## Key files

- `frontend/src/app/cad/lib/store.ts` — all mutation helpers
- `frontend/src/app/cad/lib/store.spec.ts` — unit tests
