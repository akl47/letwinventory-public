# CAD Sketch — SolidWorks feature parity status

Reference checklist mapping SolidWorks's Sketch tab against this project's implementation under `frontend/src/app/cad/`. Use the **Implemented** column to decide what to build next; use the **Tested by user** column as a manual smoke-test checklist.

All **Tested by user** cells start as ✗ on purpose — they get flipped to ✓ only after the project owner has manually exercised the feature in the running app.

_Last reviewed against commit:_ `a712898` (working tree)

## Legend

- **✓** — Implemented and shippable. Data type, op, and UI wiring all present (where applicable).
- **✗** — Not implemented at all.
- **▲** — Partial. Use when any of: data type exists in `types.ts` but no UI tool surfaces it; UI exists but only covers the common case; achievable via composition of existing tools but no dedicated one-click tool.
- **N/A** — Column doesn't apply.

## Counting rules

These are judgement calls — recorded here so they can be challenged:

1. **Centerline** → ✓. Dedicated `centerline` Tool in `cad-sketch-editor.component.ts` reuses the line gesture and pre-flags the commit as `construction: true`. Shares `draftLineStart` with Line + Midpoint Line so chains survive tool switches.
2. **Smart dimension vs. individual h/v/linear/angular dim**: the smart-dim row gets ✓, and the four per-type dim rows ALSO get ✓ — the underlying constraint types exist in the `ConstraintType` enum and smart-dim auto-dispatches to them based on the selection.
3. **Partial ellipse** → ✓. `addEllipticalArc` helper in `store.ts` materializes an `EllipticalArcEntity`. UI tool `partial-ellipse` collects 5 clicks (center, major-end, minor radius, start angle, end angle).
4. **Parabola / Conic** → ▲ (deferred). `ConicEntity` is declared in `types.ts` but parameter set is "Phase C deferred"; no solver primitive, no UI. Each needs a substantial new constraint solver translation.
5. **Style spline** → ✓. Spline tool now has a `style-spline` variant that prompts for degree at the start of the gesture (`addSpline(state, cps, degree)` already supported variable degree).
6. **Spline-on-surface / equation-driven curve** → ✗. Both need substantial new infrastructure (3D parametric mapping, parametric curve generator).
7. **Convert Entities + re-projection** → ✓. `projectedFrom` on `SketchEntityBase`, re-applied each solve. Appears once under Edit & Modify (the user-facing tool) and once under Special (the cross-cutting re-projection invariant) — same feature, two surfaces.
8. **Merge Points** → ✓. `mergePoints` in `store.ts` collapses two point ids into one, rewriting all entity references (line endpoints, circle/arc centers, spline CPs) and dropping any constraint that would become self-referential. UI: a "Merge Points" button in the relations panel (action-style, not a persisted constraint).
9. **Driven dimensions** → ✓. Optional `driven?: boolean` flag on `SketchConstraint`. Solver + determinacy analyzer both skip driven dims; the renderer wraps the value in parentheses.

## Sketch entities and creation tools

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Point | ✓ | ✓ | ✗ | `store.ts:47` `addPoint`; covered in `store.spec.ts` |
| Line | ✓ | ✓ | ✗ | `store.ts:53` `addLine` (accepts `{ construction }`) |
| Centerline | ✓ | ✓ | ✗ | UI tool `centerline` in `cad-sketch-editor.component.ts`; dispatches to `handleLineClick(mode='construction')` |
| Midpoint line | ✓ | ✓ | ✗ | UI tool `midpoint-line`; emits the line plus an auto-pinned midpoint coincident |
| Corner rectangle | ✓ | ✓ | ✗ | `store.ts:184` `addRectangleCorners` |
| Center rectangle | ✓ | ✓ | ✗ | `store.ts:226` `addRectangleCenter` (with diagonal construction line) |
| 3-point corner rectangle | ✓ | ✓ | ✗ | `store.ts` `addRectangle3PtCorner` + UI tool `rect-3pt-corner` |
| 3-point center rectangle | ✓ | ✓ | ✗ | `store.ts` `addRectangle3PtCenter` + UI tool `rect-3pt-center` |
| Parallelogram | ✓ | ✓ | ✗ | `store.ts` `addParallelogram`; 4th corner derived from closure |
| Polygon | ✓ | ✓ | ✗ | `store.ts:261` `addPolygon`; N prompted in UI |
| Center circle | ✓ | ✓ | ✗ | `store.ts:63` `addCircle`, `store.ts:78` `addCircleByPoint` |
| Perimeter circle (3-pt) | ✓ | ✓ | ✗ | `store.ts:326` `addCircle3Points`; UI tool `circle-perimeter` |
| Centerpoint arc | ✓ | ✓ | ✗ | `store.ts:128` `addArcByPoints`, `store.ts:146` `addArc` |
| Tangent arc | ✓ | ✓ | ✗ | UI tool `tangent-arc` in `cad-sketch-editor.component.ts`; backed by `addArc` + tangent constraint |
| 3-point arc | ✓ | ✓ | ✗ | `store.ts:340` `addArc3Points` |
| Ellipse | ✓ | ✓ | ✗ | `store.ts:91` `addEllipseByPoints`, `store.ts:374` `addEllipse` |
| Partial ellipse | ✓ | ✓ | ✗ | `store.ts` `addEllipticalArc` + UI tool `partial-ellipse` (5-click gesture) |
| Parabola | ▲ | ✗ | ✗ | `ConicEntity.pointIds = [vertex, focus, sample]`; tessellator + picker + viewer renderer wired; `store.ts addParabolaByPoints` — UI toolbar button is the remaining gap |
| Conic | ▲ | ✗ | ✗ | Same `ConicEntity` shape covers `parabola` today; `hyperbola` placeholder kept for future |
| Spline (cubic B-spline) | ✓ | ✓ | ✗ | `store.ts:105` `addSplineByPoints`, `store.ts:391` `addSpline` |
| Style spline (variable degree) | ✓ | ✓ | ✗ | UI tool `style-spline` prompts for degree (1-9); reuses `addSpline(state, cps, degree)` |
| Spline on surface | ▲ | ✗ | ✗ | `SplineOnSurfaceEntity` declared with face uv control points; tessellator returns []; renderer / face-uv projection still pending |
| Equation-driven curve | ✓ | ✓ | ✗ | `EquationCurveEntity` (`xExpr`/`yExpr` + [tMin..tMax]); `store.ts addEquationCurve`; UI tool `equation-curve` + `handleEquationCurveClick`; tessellator evals via `new Function('t', …)` |
| Straight slot | ✓ | ✓ | ✗ | `store.ts:292` `addSlotStraight` |
| Centerpoint straight slot | ✓ | ✓ | ✗ | `store.ts` `addSlotStraightCenterpoint` + UI tool `slot-centerpoint` |
| 3-point arc slot | ✓ | ✓ | ✗ | `store.ts` `addSlotArc3Pt` + UI tool `slot-arc-3pt` |
| Centerpoint arc slot | ✓ | ✓ | ✗ | `store.ts` `addSlotArcCenterpoint` + UI tool `slot-arc-centerpoint` |
| Text | ✓ | ✓ | ✗ | `store.ts addText` / `addTextBoxByCorners`; glyph outlines extracted by `textGlyphs.ts` (backend mirror `cadTextGlyphs.js`) → extrudable profiles; UI tool `text` |
| Sketch picture | ▲ | ✗ | ✗ | `store.ts addPicture` + `PictureEntity` (anchor + size + rotation + opacity + base64 `src`); UI tool `picture` + Properties resize/rotate wired; textured-plane render in the 3D overlay still pending |

## Edit and modify tools

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Fillet | ✓ | ✓ | ✗ | `sketchEditOps.ts:1195` `computeFilletGeometry`, `:1362` `filletLines` |
| Chamfer | ✓ | ✓ | ✗ | `sketchEditOps.ts:1238` `computeChamferGeometry`, `:1449` `chamferLines` (modes: equal / dist-dist / dist-angle) |
| Offset entities | ✓ | ✓ | ✗ | `sketchEditOps.ts:1072` `offsetCurve` |
| Convert entities | ✓ | ✓ | ✗ | `projectedFrom` on `SketchEntityBase` (`types.ts:21`); UI tool `convert-entities`; re-projects each solve |
| Intersection curve | ✗ | ✗ | ✗ | Would project body-vs-plane intersection — not implemented |
| Trim | ✓ | ✓ | ✗ | `sketchEditOps.ts:254` `trimAt` (line / circle / arc) + preview helpers at `:53`, `:93`, `:120` |
| Extend | ✓ | ✓ | ✗ | `sketchEditOps.ts:791` `extendLine` — lines only |
| Split | ✓ | ✓ | ✗ | `sketchEditOps.ts:938` `splitLineAt` — lines only |
| Jog line | ✓ | ✓ | ✗ | `sketchEditOps.ts` `jogLineAt` + UI tool `jog` (3-click gesture); replaces a line with 5 Z-jog segments |
| Construction toggle | ✓ | ✓ | ✗ | `store.ts:526` `setConstructionFlag` |
| Mirror | ✓ | ✓ | ✗ | `sketchEditOps.ts:971` `mirrorEntities` |
| Dynamic mirror | ✓ | ✓ | ✗ | UI tool `dynamic-mirror`; hooks into `commit()` so every freshly-added entity gets mirrored across the chosen axis line. Toggle off by reclicking the tool. |
| Linear sketch pattern | ✓ | ✓ | ✗ | `sketchEditOps.ts` `linearPatternEntities` + UI tool `pattern-linear` |
| Circular sketch pattern | ✓ | ✓ | ✗ | `sketchEditOps.ts` `circularPatternEntities` + UI tool `pattern-circular` |
| Move | ✓ | ✓ | ✗ | `sketchEditOps.ts:1620` `moveEntities` |
| Copy | ✓ | ✓ | ✗ | `sketchEditOps.ts:1703` `copyEntities` |
| Rotate | ✓ | ✓ | ✗ | `sketchEditOps.ts:1639` `rotateEntities` |
| Scale | ✓ | ✓ | ✗ | `sketchEditOps.ts:1661` `scaleEntities` |
| Stretch | ✓ | ✓ | ✗ | `sketchEditOps.ts` `stretchEntities` + UI tool `stretch` — only moves point entities in the selection, so attached lines stretch |

## Geometric constraints (relations)

| Relation | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Coincident | ✓ | ✓ | ✗ | `types.ts:121`; dispatches point-point / point-line / point-curve in `solver.ts` |
| Concentric | ✓ | ✓ | ✗ | `types.ts:132`; two circles/arcs share center |
| Coradial | ✓ | ✓ | ✗ | `types.ts:133`; share center AND radius (both locked) |
| Collinear | ✓ | ✓ | ✗ | `types.ts:134` |
| Perpendicular | ✓ | ✓ | ✗ | `types.ts:126` |
| Parallel | ✓ | ✓ | ✗ | `types.ts:127` |
| Tangent | ✓ | ✓ | ✗ | `types.ts:128`; line-circle / line-arc / circle-circle / arc-arc dispatch in `solver.ts` |
| Horizontal | ✓ | ✓ | ✗ | `types.ts:123` |
| Vertical | ✓ | ✓ | ✗ | `types.ts:124` |
| Equal | ✓ | ✓ | ✗ | `types.ts:129`; line-length-equal OR circle/arc-radius-equal variants |
| Equal curvature | ✗ | ✗ | ✗ | Not in `ConstraintType` enum — needs spline G2 continuity math + solver primitive |
| Symmetric | ✓ | ✓ | ✗ | `types.ts:130`; two points across a line |
| Fix | ✓ | ✓ | ✗ | `types.ts:122` (`fixed`) |
| Merge points | ✓ | ✓ | ✗ | `store.ts` `mergePoints` action button in the relations panel; collapses two points into one |
| Midpoint | ✓ | ✓ | ✗ | `types.ts:131` |
| Pierce | ✗ | ✗ | ✗ | Not in enum; 3D-edge-pierces-sketch-plane projection — needs Convert-Entities-style 3D-to-2D mapping |

## Dimensions

| Dimension | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Smart dimension | ✓ | ✓ | ✗ | UI tool `smart-dim`; auto-dispatches to specific type based on selection |
| Horizontal dimension | ✓ | ✓ | ✗ | `horizontal-distance` constraint (`types.ts:138`); reached via smart-dim |
| Vertical dimension | ✓ | ✓ | ✗ | `vertical-distance` constraint (`types.ts:139`); reached via smart-dim |
| Linear (distance) dimension | ✓ | ✓ | ✗ | `distance` constraint (`types.ts:125`); PlaneGCS `p2p_distance` |
| Angular dimension | ✓ | ✓ | ✗ | `angle` constraint (`types.ts:137`); PlaneGCS `l2l_angle_pppp` |
| Radius | ✓ | ✓ | ✗ | `radius` constraint (`types.ts:135`) |
| Diameter | ✓ | ✓ | ✗ | `diameter` constraint (`types.ts:136`) |
| Arc length | ✓ | ✓ | ✗ | `arc-length` constraint (`types.ts:141`) |
| Chord distance | ✓ | ✓ | ✗ | `chord-distance` constraint (`types.ts:142`); maps to PlaneGCS `p2p_distance` between arc.startId and arc.endId |
| Ordinate | ✗ | ✗ | ✗ | Baseline-relative dim chain — needs new constraint with multi-target chain semantics |
| Path length | ✗ | ✗ | ✗ | Sum-of-edge-lengths on a chain — same shape as ordinate |
| Point-line distance | ✓ | ✓ | ✗ | `point-line-distance` constraint (`types.ts:140`); recently rendered SW-style for parallel lines |

## Special and cross-cutting

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Construction toggle (toolbar) | ✓ | ✓ | ✗ | `store.ts:526` `setConstructionFlag` |
| Convert-Entities link re-projection | ✓ | ✓ | ✗ | `projectedFrom` re-applied each solve in `solver.ts`, recognized in `determinacy.ts` |
| Driven dimensions | ✓ | ✓ | ✗ | Optional `driven?: boolean` on `SketchConstraint`; solver + determinacy skip them; renderer wraps in `(…)` |
| Equations (parametric dim values) | ✓ | ✓ | ✗ | `equations.ts` `setEquation` / `resolveEquations`; `equations.spec.ts` |
| Per-dimension unit override | ✓ | ✓ | ✗ | `unit?: 'mm' \| 'um' \| 'in'` on `SketchConstraint` (`types.ts:159`); `units.spec.ts` |
| Origin point | ✓ | ✓ | ✗ | `ORIGIN_POINT_ID` (`store.ts:24`); auto-inserted by `ensureOriginPoint` |
| Under-/over-determined detection | ✓ | ✓ | ✗ | `determinacy.ts`; `determinacy.spec.ts` |
| Profile extraction (closed loops) | ✓ | ✓ | ✗ | `profile.ts`; `profile.spec.ts` |
| Inference (snapping while drawing) | ✓ | ✓ | ✗ | `inference.ts`; `inference.spec.ts` |
| H/V alignment inference (armed refs) | ✓ | ✓ | ✗ | `inference.ts` `inferAlignment` (REQ 825–827); hovering arms a reference point, dashed guide lines, auto H/V relation on placement |
| External-reference snap (on-edge / vertex) | ✓ | ✓ | ✗ | `externalSnap.ts` (REQ 792–796); snapping a sketch point onto a projected model edge/vertex creates an `on-edge` external ref, re-projected each regen (`cadProjection.js`) |
| Projected arc/circle center snap (concentric / coincident) | ✓ | ✓ | ✗ | `externalSnap.ts` `cand-c-` center candidates + `document.ts circleCenterFromProjected` (REQ 830–832); circle/arc center → concentric, point/line-end → coincident-to-center; hint glyph + live re-projection |
| Curved-edge hover highlight | ✓ | ✓ | ✗ | `externalSnap.ts closestPointOnPolyline` + `document.ts` curved-edge candidates; projected arcs/circles highlight on hover (no on-edge ref to a curved chord) |
| Dimension to projected model edge | ✓ | ✓ | ✗ | Smart-dim from a sketch point/line to a projected straight model edge (commit `bbb0515`); `point-line-distance` external ref, no Convert needed |

## Summary counts

- **Sketch entities & creation tools**: 25 ✓ / 4 ▲ / 0 ✗ — **25 of 29 fully implemented** (~86%)
- **Edit & modify tools**: 18 ✓ / 0 ▲ / 1 ✗ — **18 of 19 implemented** (~95%)
- **Geometric constraints**: 14 ✓ / 0 ▲ / 2 ✗ — **14 of 16 implemented** (~88%)
- **Dimensions**: 10 ✓ / 0 ▲ / 2 ✗ — **10 of 12 implemented** (~83%)
- **Special / cross-cutting**: 14 ✓ / 0 ▲ / 0 ✗ — **14 of 14 implemented** (100%)
- **Combined**: 81 ✓ / 4 ▲ / 5 ✗ — **81 of 90 fully implemented** (~90%)

What's left:

- **Remaining ▲ (partial)**: parabola + conic (full solver primitive / hyperbola), spline-on-surface (face-uv projection), sketch picture (textured-plane render in the overlay).
- **Heavy lifts (each = multi-session)**: intersection curve, pierce (3D-edge projection), equal-curvature (spline G2 math), ordinate + path-length dims (new chain-style constraint semantics).

_Tested-by-user counts deliberately start at 0 — flip cells to ✓ as the project owner manually exercises each feature in the running app._
