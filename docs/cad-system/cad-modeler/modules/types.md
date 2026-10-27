# Types

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **types**
> Related: [Sketching](../sketching.md) · [Constraints](../constraints.md) · [Feature Tree](../feature-tree.md) · [store](./store.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 559 | unapproved | Discriminated-union `SketchEntity` with `kind` tag |
| 561 | unapproved | Constraint targets as `{ entityId, sub? }` entity references |
| 545 | unapproved | Ordered feature list; each feature has a unique ID, type, and typed parameters |

### REQ 559 — SketchEntity tagged union

- **Description:** The CAD module shall represent every sketch primitive — point, line, circle, arc, ellipse, elliptical arc, spline, conic — as a discriminated-union `SketchEntity` with a `kind` tag, replacing the prior schema's separate points and lines arrays.
- **Rationale:** A unified entity type makes constraints, picking, rendering, persistence, and tessellation work uniformly across analytic and free-form geometry, instead of branching per primitive in every consumer.
- **Verification:** Consumer tests operate on tagged-union values across `store.spec.ts`, `solver.spec.ts`, `profile.spec.ts`, `migration.spec.ts`, `document.spec.ts`, `tessellator.spec.ts`, `picking.spec.ts`.
- **Validation:** Adding a new primitive type requires extending the union and adding cases, not introducing a parallel array.

---

## Succinct description

`types.ts` is the single-source-of-truth type file for the entire CAD module. It declares the `SketchEntity` tagged union, `SketchConstraint`, `SketchState`, `SketchDocument`, the `Feature` tagged union (all feature types), `FeatureTree`, `ModelGeometry`, and every supporting interface. No framework dependencies; no runtime logic beyond a handful of pure helper functions.

---

## How it works — for everyone (non-technical)

This file is like a dictionary that defines what every data structure in the CAD system looks like. Other files read from this dictionary when they need to know "what fields does a Circle have?" or "what kinds of features can exist?" Keeping all these definitions in one place means there's a single authoritative answer to those questions.

---

## How it works — in detail (technical)

### SketchEntity union (REQ 559)

All 13 member types share `SketchEntityBase` (which carries `id: string` and `construction?: boolean`):

| Kind | Key fields |
|------|-----------|
| `point` | `x, y` |
| `line` | `startId, endId` |
| `circle` | `centerId, radius` |
| `arc` | `centerId, startId, endId, radius, ccw` |
| `ellipse` | `centerId, majorAxisEndId, minorRadius` |
| `ellipticalArc` | `centerId, majorAxisEndId, minorRadius, startAngle, endAngle, ccw` |
| `spline` | `controlPointIds[], degree` (uniform clamped B-spline) |
| `conic` | `conicType: 'parabola'|'hyperbola', pointIds[]` |
| `text` | `text, cornerIds?[BL,BR,TR,TL], justify?, font?, mirror?, rotation?, anchorId?, size?` |
| `picture` | `anchorId, src, width, height, rotation, opacity` |
| `equation` | `xExpr, yExpr, tMin, tMax, samples` |
| `intersection` | `sourceBodyId` |
| `splineOnSurface` | `faceId, uvControlPoints[], degree` |

Backwards-compat aliases: `SketchPoint = PointEntity`, `SketchLine = LineEntity`.

### Constraints (REQ 561)

`ConstraintSubElement = 'start' | 'end' | 'center' | 'edge'`

`ConstraintTarget = { entityId: string; sub?: ConstraintSubElement }`

`ConstraintType` is a union of 23 string literals covering geometric constraints (coincident, fixed, horizontal, vertical, perpendicular, parallel, tangent, equal, symmetric, midpoint, concentric, coradial, collinear) and dimensional constraints (distance, radius, diameter, angle, horizontal-distance, vertical-distance, point-line-distance, arc-length, chord-distance) plus `on-edge` (Convert Entities link).

`SketchConstraint` carries `id, type, targets, value?, placement?, unit?, driven?, externalRef?, chainId?`.

### Helper functions

| Function | Purpose |
|----------|---------|
| `pointsOf(state)` | Filter entities to `PointEntity[]` |
| `linesOf(state)` | Filter entities to `LineEntity[]` |
| `findEntity<E>(state, id)` | Typed entity lookup by id |
| `findPoint(state, id)` | Point-specific lookup |
| `findLine(state, id)` | Line-specific lookup |
| `isProjectedEntity(state, entityId)` | True when any `on-edge` constraint targets this entity |
| `findOnEdgeConstraint(state, entityId)` | Find the `on-edge` constraint for this entity |

### Feature union (REQ 545)

`Feature` is a tagged union of 21 types:

`OriginFeature` · `ExtrudeFeature` · `CutExtrudeFeature` · `RevolveFeature` · `CutRevolveFeature` · `SweepFeature` · `CutSweepFeature` · `FilletFeature` · `ChamferFeature` · `DatumPlaneFeature` · `MirrorFeatureFeature` · `LinearPatternFeature` · `CircularPatternFeature` · `ShellFeature` · `DatumAxisFeature` · `DatumPointFeature` · `CombineFeature` · `HoleFeature` · `LoftFeature` · `MirrorBodyFeature` · `MoveCopyBodyFeature`

Key feature fields common across sketch-based features: `id, type, sketchId, distance, visible?, suppressed?, flipped?, endCondition?, startCondition?, direction2?, regionIndices?, merge?, name?, createdAt?`.

`ExtrudeEndCondition` is a tagged union: `blind | midPlane | throughAll | upToVertex | upToSurface | offsetFromSurface | upToBody`.

`ExtrudeStartCondition` is a tagged union: `sketchPlane | offset | upToVertex | upToSurface | offsetFromSurface`.

`FeatureTree = { features: Feature[]; nextFeatureSeq: number; defaultUnit?: 'mm'|'um'|'in' }`.

### Geometry output types

`ModelGeometry = { datums: DatumElement[]; faces: FaceMesh[]; topology: ModelTopology }`.

`FaceMesh` carries `faceId, positions, normals, indices` (typed arrays) plus optional `featureId?, isFlat?, boundaryEdgeIds?`.

`ModelTopology` carries `vertices` and `edges` (with `id, isStraight, isTangent?, endpoints, polyline?`).

---

## Key files

- `frontend/src/app/cad/lib/types.ts` — all type definitions
