# Tessellator

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **tessellator**
> Related: [profile](./profile.md) · [picking.md](./picking.md) · [Sketching](../sketching.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 562 | unapproved | Chord-height tessellator converting curved entities to polylines for the extrude kernel |

### REQ 562 — Chord-height tessellator

- **Description:** The CAD module shall convert curved sketch entities into polyline approximations using a chord-height tessellator with a configurable tolerance, producing input suitable for the existing pure-JS extrude kernel.
- **Rationale:** The pure-JS extrude kernel operates on straight-edge polygons. Curves must be tessellated to participate in extrusion, and the tessellation must adapt to entity scale so small features get adequate facets and large features do not waste vertices.
- **Verification:** `frontend/src/app/cad/lib/tessellator.spec.ts` — `segmentsForCircle` matches the analytical chord-height formula within ±1; tessellated vertices stay within `radius + 1e-6` of center; midpoint chord-error ≤ tolerance; arc segment count scales linearly with sweep; `tessellateEntity` dispatches correctly per kind.
- **Validation:** An extruded cylinder renders as a faceted cylinder with no visible flat sides at default zoom.

---

## Succinct description

`tessellator.ts` converts curved `SketchEntity` values (circles, arcs, ellipses, splines, conics, equation curves) into polyline arrays. The segment count adapts to the curve's radius and the configured chord-height tolerance so small curves stay smooth without over-sampling large ones.

---

## How it works — for everyone (non-technical)

Real CAD software draws curves as true mathematical shapes, but the 3D extrude engine only understands straight lines. The tessellator's job is to approximate every curve as a chain of short line segments that are close enough to the true curve that you can't see the difference at normal zoom. Bigger circles get more segments; tiny ones get fewer. The "chord tolerance" setting controls how smooth the approximation is.

---

## How it works — in detail (technical)

### Segment count formula

For a circle of radius `r` approximated by `n` equal-angle chord segments, the maximum chord height (sagitta) is `h = r·(1 − cos(π/n))`. Solving for `n` given tolerance `ε`:

```
n = ⌈π / acos(1 − ε/r)⌉
```

`segmentsForCircle(radius, chordTolerance)` implements this formula, clamped to a minimum of 3. `segmentsForArc(radius, sweepAbs, chordTolerance)` scales the full-circle count proportionally by `sweepAbs / (2π)`.

`DEFAULT_CHORD_TOLERANCE = 0.05` is used when no tolerance is specified.

### Per-entity dispatch (`tessellateEntity`)

| Kind | Output |
|------|--------|
| `point`, `line` | `[]` — points and lines don't need tessellation |
| `circle` | `tessellateCircle` — `n+1` points including closing duplicate |
| `arc` | `tessellateArc` — sweeps from `startAngle` to `endAngle` respecting `ccw` |
| `ellipse` | `tessellateEllipse` — uses the larger of major/minor radius for segment count, renders in the ellipse's local frame (ux, uy basis from center→majorAxisEnd) |
| `spline` | `tessellateSpline` — uniform clamped B-spline via De Boor's algorithm; sample count scales with control-polygon chord length |
| `conic` (parabola) | `tessellateParabola` — adaptive uniform x-sampling in local parabola frame; segment count from `segmentsForCircle(2p, tol)` where `p = |V→F|` |
| `equation` | `tessellateEquationCurve` — `n` evenly-spaced `t` values compiled via `Function` constructor; skips NaN/Infinity results |
| `ellipticalArc`, `text`, `picture`, `intersection`, `splineOnSurface` | `[]` — rendered directly by other means |

### De Boor's algorithm (spline)

`tessellateSpline` builds a uniform clamped knot vector (`degree+1` zeros, interior integers, `degree+1` of the max knot) and samples the parametric domain `[knots[degree], knots[n-degree-1]]` at equally spaced `u` values. Each sample is evaluated via `deBoor(pts, knots, degree, u)` using the standard iterative triangle recurrence.

### Exported helpers used by other modules

- `tessellateCircle`, `tessellateArc`, `tessellateEllipse`, `tessellateSpline` — imported by `picking.ts` for ellipse/spline hit-testing and by `profile.ts` for profile loop tessellation
- `tessellateEquationCurve` — imported by profile extraction
- `DEFAULT_CHORD_TOLERANCE` — shared constant

---

## Key files

- `frontend/src/app/cad/lib/tessellator.ts` — all tessellation
- `frontend/src/app/cad/lib/tessellator.spec.ts` — unit tests
