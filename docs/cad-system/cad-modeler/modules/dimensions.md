# Dimensions

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Constraints](../constraints.md) ▸ **dimensions**
> Related: [Constraints](../constraints.md) · [solver](./solver.md) · [types](./types.md)

---

## Requirements

Requirements are governed by [Constraints](../constraints.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 590 | unapproved | Radius dimension constraint on a circle or arc |
| 591 | unapproved | Diameter dimension constraint |
| 592 | unapproved | Angle dimension constraint between two lines |
| 593 | unapproved | Horizontal distance dimension |
| 594 | unapproved | Vertical distance dimension |

---

## Succinct description

`dimensions.ts` has two responsibilities: (1) choosing and computing dimension constraint types for two-point Smart Dim based on cursor position; and (2) computing `DimensionRender` geometry (label anchor, dimension line endpoints, extension lines) for every dimensional constraint in a sketch for the viewer to draw.

---

## How it works — for everyone (non-technical)

When you add a dimension to a sketch — a length, radius, or angle — the dimension appears as a labeled line with witness lines from the measured geometry. This module figures out where to draw all those lines and what text to show, without doing any drawing itself. It also handles the SolidWorks-style Smart Dim behavior where placing the dimension label above or below the geometry automatically chooses horizontal vs. diagonal distance.

---

## How it works — in detail (technical)

### Dimension type selection

`chooseTwoPointDimType(p1, p2, cursor)` returns `'distance'`, `'horizontal-distance'`, or `'vertical-distance'` based on where the cursor sits relative to the bounding box of the two points:
- Cursor inside the bbox's x-range but outside y-range → `horizontal-distance`
- Cursor inside the bbox's y-range but outside x-range → `vertical-distance`
- Otherwise → `distance`

`twoPointDimValue(p1, p2, type)` computes the unsigned scalar for the chosen type.

### Render computation

`dimensionRenders(state, defaultUnit?)` iterates all constraints with types in `DIMENSIONAL_TYPES` (distance, radius, diameter, angle, horizontal-distance, vertical-distance, point-line-distance, arc-length, chord-distance) and calls `computeRender` for each. Chain-internal constraints (same `chainId` but no `placement`) are skipped — only the chain's one labeled member renders.

`previewDimension(state, type, targetIds, value, placement, defaultUnit?)` computes a render for a proposed dimension before it exists in the sketch — used for the Smart Dim third-click preview.

#### Per-kind layout

| Type | Dimension line | Extension lines |
|------|---------------|-----------------|
| `distance` | Parallel to the A→B segment, offset perpendicularly by `placement` | From A and B to the dimension line |
| `horizontal-distance` | Horizontal at `placement.y` | Vertical from A and B down to the dimension line |
| `vertical-distance` | Vertical at `placement.x` | Horizontal from A and B to the dimension line |
| `radius` | Leader from circumference to `placement` | None |
| `diameter` | Chord through center, from edge to edge in direction of `placement` | None |
| `angle` | Chord from each line's intersection point along each direction at arc radius | Two lines from intersection along each line |
| `point-line-distance` | Perpendicular from point to line (or parallel-line layout when the point is an endpoint of a parallel line) | Point to dim line; foot-on-line to dim line |
| `arc-length` | None — arc length uses a leader style | None |
| `chord-distance` | Same as `distance` between the arc's start and end points | Same as distance |

### Text formatting

`formatDimensionText(type, value, dimUnit, defaultUnit)` produces the human-readable label:
- Lengths: `formatWithUnit(value, unit, true)` — unit suffix always shown
- Radius: prefixed with `"R "`
- Diameter: prefixed with `"⌀ "`
- Angle: converted from radians to degrees, suffixed with `"°"`
- Horizontal distance: `"↔ " + num`; vertical: `"↕ " + num`; point-line: `"⊥ " + num`; arc-length: `"~ " + num`; chord: `"— " + num`

Driven dimensions (read-only, displaying current geometry) are wrapped in parentheses by `renderConstraint`.

### `DimensionRender` shape

```typescript
interface DimensionRender {
  constraintId: string;
  text: string;
  labelAnchor: { x: number; y: number };
  dimensionLine: [{ x, y }, { x, y }] | null;
  extensionLines: Array<[{ x, y }, { x, y }]>;
}
```

`labelAnchor` is where the viewer places the CSS2D text pill. `dimensionLine` and `extensionLines` are projected onto the sketch plane by the viewer and rendered as Three.js lines.

---

## Key files

- `frontend/src/app/cad/lib/dimensions.ts` — all dimension logic
