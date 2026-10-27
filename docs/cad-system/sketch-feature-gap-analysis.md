# Sketch Feature Gap Analysis

Every missing or partially-implemented 2D sketch feature in the CAD module, with an implementation recipe and a draft requirement for each. This complements — and where noted, supersedes — two older documents: [`docs/cad-sketch-status.md`](../cad-sketch-status.md) (the full ✓/▲/✗ parity table; this doc covers only the non-✓ rows plus gaps that table doesn't track) and the sketcher section of [`cad-modeler/sw-onshape-divergence-review.md`](./cad-modeler/sw-onshape-divergence-review.md) (several of whose findings have since been fixed — see the reconciliation note below).

_Last reviewed against commit:_ `b6c9c2b` (branch `cad`, 2026-07-07). Every file:line anchor below was verified by reading the source at this commit.

**What "fully wired" means.** A sketch feature counts as complete only when the whole chain works: toolbar button → draw interaction → entity in `types.ts` → solver geometry (`buildPrimitives`) → tessellation → picking → profile extraction (extrudable where meaningful). "Partial" (◐) names the exact stage where the wiring stops.

**Legend**

| Mark | Meaning |
|---|---|
| ◐ | Partial — some stages wired, at least one missing |
| ✗ | Absent — no implementation |
| S / M / L / XL | Effort: hours / a session / multi-session / architecture-level |

**Draft REQs.** Each gap carries a draft requirement block. **None of these have been created** — they are ready to run through `/feature` + `node scripts/req.js create` in an implementation session. Suggested parents reference existing sketch REQ anchors (558 solver, 617/620 profiles, 830–832 external refs, 862 ribbon params) and should be confirmed against `req.js tree` before creation.

---

## At a glance

The sketcher is ~90% complete against the SolidWorks tool matrix (81✓/4▲/5✗ per `cad-sketch-status.md`), and the everyday path — lines, circles, arcs, rectangles, polygons, constraints, smart dimensions, trim/offset/mirror/patterns — is solid end-to-end. The gaps cluster in five places:

1. **Curve classes beyond line/circle/arc are second-class citizens.** Ellipses, splines, parabolas, and equation curves draw, tessellate, and pick — but have **no solver geometry** and **no profile extraction**, so they can't be constrained or extruded. Worse, two ellipse constraints are offered that actively **break the solve** when applied (cluster A).
2. **One entity is unselectable.** Partial ellipses (`ellipticalArc`) can be drawn but never picked (cluster B).
3. **Edit ops stop at lines.** Extend/split/jog are line-only; sketch fillet can't do arc+arc; chamfer can't do line+arc (cluster D).
4. **The external-reference constraint matrix is incomplete.** Parallel/perpendicular/distance-to-model-edge work; angle and tangent to a model edge don't. Redundancy diagnostics exist in the vendored solver but are never read (cluster E).
5. **A few tools and dimension types are missing outright** — intersection curve (entity exists, zero callers), fully-define-sketch, 3-point angular dims, ordinate dims (cluster F).

**Cheapest high-impact wins:** the slot-extrusion "limitation" is almost certainly a stale error mapper, not a real gap (C, S); making partial ellipses pickable is one function (B, S); the last two `window.prompt` sites have an established ribbon-param pattern to copy (G, S); redundancy reporting is a copy of the existing conflict path (E2, S–M).

**Reconciliation with `sw-onshape-divergence-review.md` (2026-07-02).** The following sketcher findings in that review are **fixed** as of this commit and should not be re-reported: no conflict diagnosis (fixed — REQ 860, per-constraint red highlight), no crossing box selection (fixed — crossing select shipped), no perpendicular/parallel inference (fixed — REQ 864), mandatory 1 mm grid snap with no toggle (fixed — sketch settings, REQ 865), no driven↔driving toggle (fixed — REQ 855), trim refusing construction geometry (fixed — REQ 866), and most `window.prompt` dimensional/parameter entry (largely fixed — REQ 862 ribbon params; two sites remain, see cluster G).

---

## A. Curve classes not first-class (ellipse / spline / parabola / equation curve)

The top-severity cluster. These four entity kinds draw, tessellate (`tessellator.ts:234-287`), and pick — but stop there:

| Feature | Status | Where the wiring stops |
|---|---|---|
| Ellipse — constrainable | ◐ | `buildPrimitives` (`solver.ts:420-496`) registers only point/line/circle/arc. **Active bug:** `translateConstraint` emits `point_on_ellipse` (solver.ts:198) and `tangent_le` (solver.ts:101) referencing an ellipse id that is never pushed — `push_primitives_and_params` throws, so applying either constraint breaks the whole solve rather than no-oping. |
| Ellipse — extrudable | ◐ | `profile.ts:segmentsOf` (136-147) and `arrangement.ts:gatherCurves` (306) walk line/circle/arc only. |
| Spline / style spline — constrainable | ◐ | Control points solve as free points; the curve itself has no GCS geometry (no tangent-to-spline, no equal). |
| Spline — extrudable | ◐ | Same `segmentsOf` gap. |
| Parabola (`conic`) — constrainable / extrudable | ◐ | Same two gaps. Draws via `addParabolaByPoints`. |
| Equation curve — extrudable | ◐ | Same profile gap. (Constraining an arbitrary parametric curve is permanently out of scope — document, don't fix.) |
| `ellipticalArc` — solver geometry | ◐ | Needs `SketchArcOfEllipse` + synthetic endpoint points (the entity stores only angles). Second pass after the ellipse. |

### Fix A1 — solver registration (ellipse first, then parabola, then ellipticalArc) — **M**

PlaneGCS's ellipse primitive is `SketchEllipse { c_id, focus1_id, radmin }` (`vendor/planegcs/sketch/sketch_primitive.d.ts:30-35`) — FreeCAD's parameterization: center point, focus-1 point, minor radius. Our `EllipseEntity` stores `centerId`, `majorAxisEndId`, `minorRadius` (`types.ts:46-51`). In `buildPrimitives`:

1. Push a **synthetic, non-fixed focus point** `_efoc_${e.id}` at center + majorDir·√(a²−b²), where a = |center→majorAxisEnd| and b = `minorRadius`.
2. Push `{ id: e.id, type: 'ellipse', c_id: e.centerId, focus1_id: '_efoc_…', radmin: e.minorRadius }`.
3. Tie the stored major-axis endpoint to the conic with `internal_alignment_ellipse_major_diameter` (`vendor/planegcs/planegcs_dist/constraints.d.ts:632-640`), which needs a second synthetic point at the opposite major vertex (`_emaj2_${e.id}`). The pattern to copy is the arc's companion-rules push (`arc_rules`, solver.ts:481): every curve gets its internal-consistency primitives automatically.
4. Extend `readBack` (solver.ts:498-516): `minorRadius` comes back from the solved primitive's `radmin`; center and major-axis points return via the existing point branch.
5. **Mirror everything in `determinacy.ts`** (residual rows for the ellipse's internal alignments) or the blue/black DoF coloring will disagree with the solver — the same dual-maintenance obligation the file already documents for its parallel/perpendicular-to-edge block (determinacy.ts:290-311).

Parabola afterwards is cheap: `SketchParabola { vertex_id, focus1_id }` maps 1:1 onto `ConicEntity.pointIds[0..1]`. `ellipticalArc` needs `SketchArcOfEllipse` (start/end ids + angles) plus synthetic endpoint points computed from the parametric angles — defer to a second pass.

**Pitfalls:** synthetic `_efoc_`/`_emaj2_` ids must not collide with the existing `_pinrad_`/`_extref` conventions; `readBack` only reads entities, so synthetic points are excluded automatically — keep it that way; `pinAllRadii` has no ellipse `radmin` lock, so accept ellipse resize during drags in v1.

> **DRAFT REQ — Ellipse and parabola as solver geometry** *(suggested parent: REQ 558)*
> - **description:** Ellipses and parabolas shall be registered as PlaneGCS solver geometry (SketchEllipse with synthetic focus and internal major-diameter alignment; SketchParabola from vertex/focus), so that point-on-ellipse, tangent-to-ellipse, and future conic constraints solve correctly, and solved minor radii are read back onto the entities.
> - **rationale:** The sketch editor currently offers point_on_ellipse and tangent_le constraints that reference solver geometry which is never registered; applying them makes the entire sketch solve fail. Conic entities that cannot be constrained are not usable in parametric workflows.
> - **verification:** frontend/src/app/cad/lib/solver-ellipse.spec.ts — register an ellipse; apply coincident (point-on-ellipse) and tangent (line-ellipse); solve succeeds; determinacy coloring matches solver DoF.
> - **validation:** User draws an ellipse, constrains a line tangent to it and a point onto it, and drags — geometry follows without the sketch turning inconsistent.

### Fix A2 — profile extraction via the Bézier lane (no kernel rebuild) — **L**

The kernel accepts exactly four profile edge kinds: `line`, `arc`, `circle`, `bezier` (`cad-kernel-cpp/src/geom_io.cpp:653-696`; `build_bezier_profile_face` at 706), and Bézier edges already flow end-to-end for text glyphs (`Geom_BezierCurve` at 783). So splines and ellipses can ride the existing Bézier lane:

- **Splines (exact):** a clamped uniform cubic B-spline converts exactly to a chain of cubic Béziers via knot insertion (Böhm's algorithm). Add a `bezierSegsFromSpline()` used by both `profile.ts` and `backend/services/cadProfile.js`.
- **Ellipses (approximate):** one cubic Bézier per quadrant (the κ-handle construction) has ~2.7×10⁻⁴ relative radial error — acceptable for v1; document the tolerance.
- **v1 scoping:** emit closed spline loops and lone ellipses **directly as loops before the arrangement walker**, exactly like the text-glyph branch (`profile.ts:183-195` — copy it including its "emit FIRST so region indices line up" ordering comment). Extending the DCEL intersector to ellipse-vs-line crossings is a much bigger job — defer, and reject mixed chains with a clear error message.
- **Later (optional):** an exact `"ellipse"` edge kind in the kernel via `GC_MakeArcOfEllipse` (geom_io.cpp `build_profile_face`, 923) — requires a user-triggered kernel rebuild and a paired `NAMING_VERSION`/`NAMING_SCHEMA_VERSION` bump (`backend/services/cadRegenService.js:149`).

**Hard invariant:** the converter must exist in both runtimes with identical loop ordering — `profile.ts` ↔ `cadProfile.js` and `arrangement.ts` ↔ `cadArrangement.js` (stored `regionIndices` are positional; see the "must mirror profile.ts exactly" header at cadProfile.js:62). Follow the `textGlyphs.ts`/`cadTextGlyphs.js` twin-file precedent with KEEP IN SYNC headers.

> **DRAFT REQ — Spline and ellipse profiles extrude via Bézier edges** *(suggested parent: REQ 617)*
> - **description:** Closed spline loops and single-ellipse profiles shall be extractable as profile regions and extrudable, by converting them to cubic Bézier edge chains (exact for cubic B-splines; four-quadrant approximation within 3×10⁻⁴ relative error for ellipses) emitted ahead of the arrangement walker in both the frontend and backend extractors, which shall produce identical region ordering.
> - **rationale:** Splines and ellipses can be drawn but never extruded; the kernel already accepts Bézier profile edges (text glyphs use them), so no kernel change is needed.
> - **verification:** frontend/src/app/cad/lib/profile-curves.spec.ts + backend/tests/__tests__/design/cad-profile-curves.test.js — identical region output both runtimes; extrude of a closed spline and a lone ellipse produces a body.
> - **validation:** User sketches a closed spline, extrudes it, and gets a solid; an ellipse extrudes to an elliptical cylinder.

---

## B. Partial ellipse (`ellipticalArc`) is unpickable — **S**

| Feature | Status | Where the wiring stops |
|---|---|---|
| Partial ellipse — selectable | ◐ | `distanceToEntity` returns `Infinity` for `ellipticalArc` (`picking.ts:156-157`) — it draws but can never be clicked, dimensioned, or deleted by selection. |

### Fix

Copy `distanceToEllipse` (picking.ts:101-110), which already establishes the sanctioned tessellation-fallback pattern (with a comment blessing tessellation over iterative closest-point). The entire body can be `distanceToPolyline(tessellateEntity(state, entity, DEFAULT_CHORD_TOLERANCE), p)` — `tessellateEntity` already handles the kind (tessellator.ts:262-270). Wire into the switch at picking.ts:156. Box/crossing select already works (`entityTouchesRect` goes through `tessellateEntity`). Keep `PICK_RANK` at 1.

> **DRAFT REQ — Partial ellipses are pickable** *(suggested parent: REQ 564 — pick accuracy independent of tessellation)*
> - **description:** Partial ellipse entities shall be hit-testable by cursor via tessellation-backed distance, selectable, and deletable like every other curve kind.
> - **rationale:** The partial-ellipse tool creates entities that cannot be selected afterward — they can only be removed by undo, which is a dead-end UX.
> - **verification:** frontend/src/app/cad/lib/picking.spec.ts — distanceToEntity for an ellipticalArc returns finite on-curve distance and respects the arc's angular sweep.
> - **validation:** User draws a partial ellipse, clicks it to select, and deletes it.

---

## C. Slot / mixed line+arc extrusion — stale error mapper, likely no real gap — **S**

| Feature | Status | Evidence |
|---|---|---|
| Slot extrusion (all 4 slot tools) | ◐ (probably ✓) | `errorMessages.ts:38-42` still ships a mapper for a kernel error "profiles mixing lines and arcs (e.g. slots) are not yet extrudable" — but **no producer of that error string exists anywhere** (kernel, backend, frontend). The kernel handles arc profile edges throughout (`geom_io.cpp:661-674`, wire building at 892/967/990), both profile walkers emit mixed line+arc loops, and the two-segment curved-lens case is explicitly allowed (`profile.ts:477-481`, `cadProfile.js:302-307`). |

### Fix

1. Manually verify in the browser: draw a straight slot (two lines + two arcs), extrude, regenerate. (Browser verification is user-owned per project rules.)
2. Assuming it extrudes: delete the stale mapper entry at `errorMessages.ts:38-42` and its spec expectations, so a *genuinely new* arc-related kernel error surfaces raw instead of being mislabeled "work in progress."
3. If some path still fails, the fault is slot-*tool* topology (duplicate points, branch degree) — diagnosable with the built-in `window.__cadDebug` dump (`profile.ts:232-300`). Fix the tool output; do **not** touch the kernel (rebuilt only by the user, and it likely needs nothing).

> **DRAFT REQ — Slot profiles extrude** *(suggested parent: REQ 620)*
> - **description:** Profiles produced by the four slot tools (straight, centerpoint, 3-point arc, centerpoint arc) shall extrude to solids, and the error catalog shall not map arc-mixing errors that the kernel no longer produces.
> - **rationale:** Slots are among the most common sketch profiles in mechanical parts; the remaining blocker appears to be a stale error mapping rather than a geometric limitation.
> - **verification:** backend/tests/__tests__/design/cad-slot-extrude.test.js — extrude each slot variant's profile; expect one body each; errorMessages spec drops the stale mapping.
> - **validation:** User draws each slot type and extrudes it successfully.

---

## D. Edit-op kind coverage — **M** (batch), **L** with ellipse/spline

All in `frontend/src/app/cad/lib/sketchEditOps.ts` unless noted.

| Op | Status | Coverage today |
|---|---|---|
| Trim | ◐ | line/circle/arc (`trimAt` 255-265; default: "Trim not supported for {kind}") |
| Extend | ◐ | **lines only** (`extendLine` 957) |
| Split | ◐ | **lines only** (`splitLineAt` 1104) |
| Jog | ◐ | **lines only** (`jogLineAt` 3727) |
| Sketch fillet | ◐ | line+line, line+arc; **arc+arc warns "not yet supported"** (component:3354-3356) |
| Sketch chamfer | ◐ | **line+line only** (`chamferLines` 3293) |
| Offset | ◐ | line/circle/arc (`offsetCurve` 1462-1517); chain offset exists |
| Trim/offset of ellipse/spline | ✗ | No intersection source for these kinds (gated on cluster A) |

Also worth documenting as sub-gaps (behavior inside implemented ops, from `sketch-test-cases.md`): split/jog/copy drop constraints; trim drops dimensional constraints (directional ones inherit); fillet can orphan corner-point dims.

### Fix — arc parity batch (items in leverage order)

1. **extendArc / splitCircleAt / splitArcAt (S–M each).** The crossing-detection infrastructure is the pattern: `collectLineHits`/`collectCircleHits`/`collectArcHits` (534/793/859) plus the analytic intersectors in `geometry.ts`. Split is structurally "trim keeping both sides" — `trimCircle` (590) and `trimArc` (664) already mint the arc pieces; a `splitArcAt` keeps every segment and skips the deletion. `extendArc` copies `extendLine`'s candidate scan parameterized by angle (reuse `angleInArcSweep`, 219). Preserve the constraint-inheritance discipline of `splitLineKeepingOnly` (330-455): directional constraints inherit, dims drop, passenger points re-attach, endpoints reuse via `acquireOrCreatePoint`.
2. **Fillet arc+arc (M).** The fillet-arc center lies at distance R₁±r from center₁ and R₂±r from center₂ → `circleCircleIntersection` of the grown/shrunk circles; pick the root nearest `sharedEndpointBetween` (2690). Copy `computeFilletLineArcGeometry`/`filletLineArc` (2855/3001) and reuse `anchorFilletTangentPoint` (3391). Only the component's "arc+arc not supported" else-branch changes.
3. **Chamfer line+arc (S–M).** Copy `chamferLines` (3293); the only new math is walking a set distance from the corner along the arc (angle = distance/R).
4. **Trim/offset for ellipse/spline (M–L, gated on A1).** Tessellation-based hit finding (tessellateEntity + segment intersection). Trimming an ellipse yields `EllipticalArcEntity` pieces (kind exists). Offset of an ellipse/spline is not the same curve family — sample the source, offset along normals, emit a `SplineEntity` (SolidWorks does the same).

**Pitfalls:** respect construction-geometry flags (REQ 866); extend the existing switch defaults rather than adding new entry points so the tool UI needs no changes.

> **DRAFT REQ — Edit-op arc parity** *(suggested parent: the sketch edit-ops REQ lineage; confirm via req.js tree)*
> - **description:** Extend, split, and jog shall support arcs and circles; sketch fillet shall support arc+arc corners; sketch chamfer shall support line+arc corners — each preserving the established constraint-inheritance rules (directional constraints inherit onto pieces; dimensional constraints drop).
> - **rationale:** Slot- and fillet-heavy sketches are ordinary mechanical workflows; line-only edit ops force users to delete and redraw curved geometry.
> - **verification:** frontend/src/app/cad/lib/sketchEditOps-arcs.spec.ts — extend/split on arcs and circles; arc+arc fillet tangency; line+arc chamfer endpoints on-curve.
> - **validation:** User fillets the two arc-arc corners of a slot-derived profile and splits an arc at a crossing line.

---

## E. Constraint and diagnosis gaps

| Item | Status | Evidence |
|---|---|---|
| Angle to model edge | ✗ | externalRef solver passes (solver.ts:604-740) cover parallel/perpendicular/p2l-distance/center/coradial/on-edge only |
| Tangent to model edge | ✗ | Same; and `translateConstraint`'s `tangent` case lacks the `if (c.externalRef) return []` guard — an external tangent would mistranslate today |
| Redundant-constraint reporting | ◐ | `get_gcs_redundant_constraints` exposed by the vendored wrapper (`gcs_wrapper.js:122-127`) but never called; only the conflicting path (solver.ts:762-780) is consumed |
| Diagonal on-edge lines | ◐ | Axis-aligned on-edge lines get horizontal/vertical enforcement; diagonal edges unenforced (solver.ts:164-165 TODO) |
| `ConstraintTarget.sub` | ◐ | Declared (`types.ts:198-203`), never consumed anywhere (only the different field `ExternalRef.sub` is live) |
| Fully-define-sketch | ✗ | See cluster F2 |
| Equal-curvature, pierce | ✗ | Heavy lifts (spline G2 math; 3D-edge-pierces-plane projection) — approach sketches only, consistent with `cad-sketch-status.md` |

### Fix E1 — angle-to-edge + tangent-to-edge — **M**

The template is fully established, three layers each:
- **Solver:** copy the `edgeOrientations` pass (collection solver.ts:641-650, synthetic fixed-points+line emission 730-740). Angle: emit two fixed points at the projected edge + `l2l_angle_pppp` with the synthetic pair as the second line, reusing `adjustAngleSignFromPoints`. Tangent: synthetic line vs the target curve via `tangentPrimitive` (solver.ts:97-108). Add the missing `if (c.externalRef) return []` short-circuit to the `tangent` case (the `parallel`/`perpendicular` cases at solver.ts:216-219 show the pattern).
- **Determinacy:** mirror in `determinacy.ts`, copying the parallel/perpendicular external residual block (290-311) — angle: rotated cross residual; tangent: |center-to-line distance| − r.
- **UI:** clone `constraintEnabled`'s edge special-cases (component:4413-4437) and `_applyOrientationToEdge` (4443-4457); angle additionally runs the `requiresValue` prompt path existing value-specs already use.

### Fix E2 — surface redundancy reporting — **S–M**

Extract the conflict pid→constraint-id mapping (solver.ts:762-778 — the exact-id, `_prefix_`, and `-suffix` conventions) into a helper and call it for redundant ids too. **Key difference: redundancy is reported on successful solves**, so query in the success branch *before* `clear_data()` (solver.ts:754). `SolveResult` gains `redundant?: string[]`. Surface as an amber twin of the conflict path: `conflictingConstraints` signal (component:1007-1012) gets a `redundantConstraints` twin; the editor computed at cad-editor.component.ts:6215-6219 gets a twin; `cad-constraint-list` gains a `redundantIds` input beside `conflictIds`. Filter solver-synthetic ids (`_pinrad_`, `_onedgerad_`) — those are expected-redundant by design.

### Fix E3 — diagonal on-edge enforcement — **S–M** (batch with E1)

Rather than a phantom line *entity*, reuse the existing **edgeRidePoints** machinery (solver.ts:604-622, 712-718): for an on-edge line on a diagonal edge with a free endpoint, emit `_extrefA/B` fixed points at the live projection plus `point_on_line_ppp` for that endpoint. That *is* the "phantom collinear reference" with zero new concepts. Keep the axis-aligned fallback for sketches whose edge projections are unavailable. Mirror in determinacy.ts (its on-edge ride residual is the twin). Batch E1+E3 to pay the solver+determinacy sync tax once.

### Fix E4 — remove `ConstraintTarget.sub` — **S**

Grep for writers first; nothing in UI code ever sets it. Delete the `sub?` field and `ConstraintSubElement` from `ConstraintTarget` (keep `ExternalRef.sub` — that one is live). Consuming it instead would duplicate what the entity model already does with first-class start/end/center point entities.

> **DRAFT REQ — Complete the model-edge constraint matrix** *(suggested parent: REQ 830)*
> - **description:** Angle and tangent constraints shall accept a projected model edge as one side (via externalRef synthetic reference geometry, matching the existing parallel/perpendicular/distance-to-edge passes), and on-edge lines on diagonal model edges shall be held collinear to the edge, not just axis-aligned ones.
> - **rationale:** The external-reference constraint matrix is inconsistent — users can dimension and orient to a model edge but not set an angle or tangency to it, and diagonal converted edges silently lose their enforcement.
> - **verification:** frontend/src/app/cad/lib/solver-external.spec.ts — angle-to-edge and tangent-to-edge solve and re-project on edge movement; a diagonal on-edge line's free endpoint stays on the edge line.
> - **validation:** User dimensions a 30° angle between a sketch line and a model edge; drags — the angle holds.

> **DRAFT REQ — Redundant-constraint diagnosis** *(suggested parent: REQ 860)*
> - **description:** After a successful solve, constraints PlaneGCS reports as redundant shall be surfaced to the user (amber highlight in the constraint list and on affected entities), excluding solver-synthetic pins that are redundant by design.
> - **rationale:** The solver already computes redundancy; discarding it hides exactly the diagnostic SolidWorks users expect when a sketch is over-annotated but not conflicting.
> - **verification:** frontend/src/app/cad/lib/solver.spec.ts — a deliberately redundant dimension is reported by id; synthetic pins are filtered.
> - **validation:** User adds a redundant dimension and sees it flagged amber rather than silently accepted.

---

## F. Missing tools and dimension types

| Feature | Status | Evidence |
|---|---|---|
| Intersection curve | ◐ | `IntersectionCurveEntity` (`types.ts:152-156`) + `addIntersectionCurve` (`store.ts:253`) exist with **zero callers**; tessellate `[]`, pick `Infinity` |
| Fully-define sketch | ✗ | DoF machinery exists (`determinacy.ts:46`), no auto-dimension command |
| Angular dim between 3 points | ✗ | angle predicate requires two lines (component:187-188); `measureAngleBetween` takes two lines (5356) |
| Arc-length dim in Smart Dim | ◐ | Manual toolbar button exists; `resolveSmartDim` (5277-5341) has no arc-length branch |
| Ordinate / baseline dims, path-length dim | ✗ | No implementation; chain-style dim semantics |
| Dual units | ✗ | `units.ts` supports one active unit; display-only gap |
| Spline-on-surface / 3D sketch | ◐/✗ | Storage-only stub (`types.ts:164-170`), no tool — designated future hook; see non-goals |

### Fix F1 — intersection curve (v1: reference overlay) — **M**

Compute body∩plane **client-side by slicing the render mesh**: for each triangle of `geometry().faces[*].positions` belonging to `sourceBodyId`, intersect with the sketch plane (two edge crossings → one segment), project via `projectFrom3D`, chain segments into polylines. The plumbing pattern is `projectFaceBoundaryToActiveSketch` (`cad-editor.component.ts:11303-11384`) — same face-mesh walking, same sketch-commit flow — and the tool arming clones the convert-entities check (11142). v1 keeps it reference-only (tessellation happens in the editor layer since `tessellator.ts` has no geometry access; picking via polyline distance). v2 option: emit construction lines/arcs via the `_projectEdgeWithTag` circle/arc fitting (11402-11431) so users can constrain against the result. Exact kernel sectioning (`BRepAlgoAPI_Section`) deferred — needs a kernel op and a user rebuild.

### Fix F2 — fully-define sketch — **M**

New lib function `fullyDefineSketch(state, externalEdges)`: loop — run `analyzeDeterminacy`, pick the first underdetermined point, add `horizontal-distance` + `vertical-distance` dims from `ORIGIN_POINT_ID` (the SolidWorks default scheme; both types exist and translate via `difference` params, solver.ts:354-380), re-run; bail after N iterations or roll back the last addition if a solve goes inconsistent. Reuse `_dimensionWouldBeRedundant` semantics (component:4404-4408) to skip already-determined targets. Pitfall: generated dims need staggered `placement` offsets or the labels stack.

### Fix F3 — angular dim between 3 points — **M** (solver cost ≈ zero)

The solver already drives angles through the 4-point primitive: targets `[rayA, vertex, rayB]` → `l2l_angle_pppp { l1p1: vertex, l1p2: rayA, l2p1: vertex, l2p2: rayB }`. Changes: the angle predicate in `CONSTRAINT_SPECS` gains `|| (3 points)`; `translateConstraint`'s angle case gains a 3-point branch (skip `orientLinesForAngle`, keep `adjustAngleSignFromPoints`); determinacy and the angle-dim renderer gain the same branch.

### Fix F4 — ordinate dims + dual units — **L** (approach sketch only)

Ordinate: a datum-zero pick + per-point `horizontal-distance`/`vertical-distance` dims sharing a leader-rendering style — the constraint layer needs nothing new; the work is renderer + placement UX. Dual units: purely display — add a secondary-unit format to the dimension label formatter (`defaultUnit` already flows to the constraint list). Neither touches solver, kernel, or backend.

Also cheap: add an arc branch to `resolveSmartDim` so Smart Dim offers arc-length on a lone arc pick (**S**).

> **DRAFT REQ — Intersection curve (reference)** *(suggested parent: REQ 770 lineage — in-context references)*
> - **description:** A sketch tool shall compute the intersection of a selected body with the active sketch plane as reference polylines (mesh-sliced client-side, chained, projected into sketch coordinates), rendered as construction-style overlay and pickable for inspection.
> - **rationale:** The entity type and store helper exist unused; sectioning a body on the sketch plane is a standard reference workflow for sketching against existing geometry.
> - **verification:** frontend spec for the mesh-slice chaining; manual E2E on a cylinder (expect an ellipse-like polyline on an angled plane).
> - **validation:** User activates Intersection Curve on a body and sees its cross-section on the sketch plane.

> **DRAFT REQ — Fully Define Sketch** *(suggested parent: REQ 558)*
> - **description:** A Fully Define Sketch command shall iteratively add origin-anchored horizontal/vertical distance dimensions to underdetermined points (skipping redundant additions, rolling back any addition that turns the solve inconsistent) until the sketch reports zero degrees of freedom or no progress is possible.
> - **rationale:** The determinacy analyzer already identifies free entities; users currently have to hunt them down one dimension at a time.
> - **verification:** frontend/src/app/cad/lib/fullyDefine.spec.ts — an under-constrained rectangle reaches DoF 0; a conflicting setup rolls back cleanly.
> - **validation:** User clicks Fully Define on a rough sketch and it turns fully constrained with sensibly placed dimensions.

> **DRAFT REQ — 3-point angular dimension** *(suggested parent: the Smart Dimension REQ lineage)*
> - **description:** Smart Dimension and the angle constraint shall accept three points (ray endpoint, vertex, ray endpoint), driving the vertex angle via the existing four-point solver primitive.
> - **rationale:** Angle currently requires two line entities; measuring the angle at a vertex between construction points is standard in every parametric sketcher.
> - **verification:** solver spec — 3-point angle drives to target and holds under drag; renderer spec for the 3-point arc leader.
> - **validation:** User picks three points and places a driven-to-value vertex angle.

---

## G. `window.prompt` remnants — **S**

Earlier reviews flagged many prompt-based parameter entries; most are already migrated to the REQ 862 ribbon-param pattern (rounded-rect radius uses `_defaultRoundedRadius` at component:4653; polygon N is a ribbon param at template 571-575). Exactly two sites survive:

| Site | Status | Location |
|---|---|---|
| Style-spline degree | ◐ | prompt at component:4867-4875 |
| Equation curve (xExpr/yExpr/tMin/tMax/samples) | ◐ | **five chained prompts** at component:4984-4995 |

### Fix

Copy the REQ 862 three-part idiom precisely: (1) a signal with a persisted default + clamping setter (pattern: `polygonSides` at component:875/882); (2) a `@case` in the ribbon `@switch (tool())` block (template 547-576) rendering `.tool-param` labeled inputs; (3) the gesture handler reads the signal at commit time (the canvas click), never prompting. Style-spline: bind the existing `styleSplineDegree` signal and delete the prompt block. Equation curve: five inputs — two *text* (first text inputs in the ribbon; widen the 56px `.tool-param input` width rule at line 666) and three number — keeping the existing validation (finite, tMin≠tMax, samples clamped 8..2000). Don't auto-commit on input change; follow the `data-testid="param-*"` naming for tests.

> **DRAFT REQ — Ribbon params for style-spline and equation curve** *(suggested parent: REQ 862)*
> - **description:** Style-spline degree and equation-curve parameters (x(t), y(t), t-range, samples) shall be entered via inline ribbon tool parameters with persisted defaults and validation, replacing the remaining window.prompt dialogs; commit remains on the canvas click.
> - **rationale:** These are the last two prompt-based entry sites; the ribbon idiom is established (REQ 862) and prompts block E2E automation and mobile use.
> - **verification:** Karma spec asserting no window.prompt call on either tool path; Playwright interaction using data-testid param inputs.
> - **validation:** User draws an equation curve entirely from ribbon inputs with no browser dialogs.

---

## Explicit non-goals (for now)

- **Hyperbola + 5-point conic** — `ConicEntity` reserves `conicType: 'hyperbola'` (types.ts:70-80) and PlaneGCS has hyperbola primitives, but there is no tessellator, picker, profile story, or user pull. If ever done, the parabola is the end-to-end template.
- **Derived / linked sketches and sketch blocks** — cross-document references and instanced sub-sketches are architecture-level features (XL), not sketcher gaps.
- **3D sketch** — contradicts the plane-projected solver and profile pipeline everywhere; the storage-only `splineOnSurface` stub (types.ts:164-170) is the designated future hook.
- **Equal-curvature and pierce constraints** — spline G2 continuity math and 3D-edge-pierces-plane projection respectively; multi-session heavy lifts already flagged in `cad-sketch-status.md`. Pierce would build on the externalRef machinery (cluster E1) once curves are first-class (cluster A).
- **Solving equation curves** — an arbitrary parametric expression has no closed-form constraint Jacobian; equation curves remain reference/profile geometry permanently.

---

## Suggested next batch (by value / effort)

1. **C — slot extrusion verification + stale mapper removal (S).** Possibly a zero-code unlock of the most-wanted profile shape; at minimum stops mislabeling real errors.
2. **B — ellipticalArc picking (S).** One function; makes an existing tool's output selectable at all.
3. **G — last two prompt migrations (S).** Pure UX debt with an in-repo pattern to copy.
4. **E2 — redundancy surfacing (S–M).** High diagnostic value; a copy of the conflict path.
5. **E1 + E3 batched — complete the model-edge constraint matrix (M).** Shares the solver+determinacy dual-maintenance cost.
6. **D — arc parity for edit ops (M).** extend/split for arcs, arc+arc fillet, line+arc chamfer; unblocks everyday slot/fillet editing.
7. **F2 fully-define + F3 3-point angle (M each).** Self-contained polish; F3's solver cost is near zero.
8. **A — curves first-class: A1 solver registration (M) then A2 Bézier profile lane (L).** Highest absolute value and the largest risk (two-runtime parity); A1 first — the current state is an active solve-breaking bug.
9. **F1 — intersection curve, reference-only v1 (M).**
10. **F4 — ordinate dims / dual units (L), opportunistic.** E4 (`ConstraintTarget.sub` removal, S) can ride along with any solver-touching batch.
