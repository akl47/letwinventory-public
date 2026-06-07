# Picking

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **picking**
> Related: [Sketching](../sketching.md) · [tessellator](./tessellator.md) · [types](./types.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 564 | unapproved | Hit-test curved entities against their parametric definition, independent of tessellation |
| 527 | unapproved | Click on a sketch primitive selects it |

### REQ 564 — Parametric picking

- **Description:** The sketch picker shall hit-test curved entities against their parametric definition (closest-point-on-curve), independent of the polyline tessellation used for rendering, so pick accuracy does not degrade with coarse tessellation.
- **Rationale:** Hit-testing tessellated polylines causes pick gaps proportional to the chord-height tolerance. Parametric picking is constant-accuracy.
- **Verification:** `frontend/src/app/cad/lib/picking.spec.ts` — `distanceToEntity` returns parametric closest-point distance for point/line/circle/arc; pick accuracy holds at coarse tessellation density; arc returns endpoint distance when query angle lies outside the sweep; `pickEntity` prefers points over lines at the same distance.
- **Validation:** A user can click on the visual edge of a small circle without seeing a miss.

---

## Succinct description

`picking.ts` exports `distanceToEntity` and `pickEntity`, which compute the minimum distance from a 2D cursor point to a sketch entity using each entity's analytic definition rather than its rendered tessellation.

---

## How it works — for everyone (non-technical)

When you click in the sketch editor, the program needs to decide which shape you clicked on. Instead of testing against the chain of little line segments the renderer draws, it tests against the true mathematical definition of each shape. A circle is tested as a real circle; a line is tested as an infinite line clipped to its endpoints. This means you can click precisely on a tiny circle or a thin line without the click "falling through the gaps" between tessellation facets.

---

## How it works — in detail (technical)

### Per-kind distance functions

| Entity kind | Algorithm |
|-------------|-----------|
| `point` | Euclidean distance to `(e.x, e.y)` |
| `line` | Perpendicular projection onto the segment; distance to the nearest point on `[a, b]` |
| `circle` | `|dist(p, center) − radius|` — ring-distance from the circumference |
| `arc` | Same as circle if the query angle lies within the CCW/CW sweep; otherwise distance to the nearer endpoint |
| `ellipse` | Tessellation-based via `tessellateEllipse` (true closest-point requires iterative root-finding; not worth it for click tolerance) |
| `spline` | Tessellation-based via `tessellateSpline` + `distanceToPolyline` |
| `conic` (parabola) | 64-sample parabola tessellation inline in `distanceToConic` |
| `equation` | N-sample evaluation via inlined `tessellateEquationCurveExternal` |
| `text` | Bounding-rect distance — uses the 4 real corner points when present, falls back to anchor + `text.length * size * 0.55` |
| `picture` | Rotated bounding-rect distance in picture's local frame |
| `ellipticalArc`, `intersection`, `splineOnSurface` | Returns `Infinity` — viewer handles selection for 3D-only entities |

### `pickEntity(state, p, tolerance, pointTolerance?)`

Two-pass algorithm:

1. **Point pass.** Any `point` entity within `pointTolerance` of `p` wins outright, regardless of how close any lines or curves are. Prevents accidental line-grabs near corners.

2. **Rank + distance pass.** `PICK_RANK` assigns: `point = 0`, most curves `= 1`, `text = 2`, `picture = 3`. The entity with the lowest rank within `tolerance` wins. Distance breaks ties within the same rank. Text and picture entities return `distance = 0` inside their bounding box; the rank rule prevents them from absorbing clicks intended for the construction lines that define the box.

---

## Key files

- `frontend/src/app/cad/lib/picking.ts` — all hit-test logic
- `frontend/src/app/cad/lib/picking.spec.ts` — unit tests
