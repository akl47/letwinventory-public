# Sketch / Constraints / Hints — Hostile Review vs SolidWorks (2026-07-09)

Three parallel deep-reads of the CURRENT working tree (including the uncommitted 07-07/08 batch): geometry tools & edit ops, the constraint system (solver + determinacy), and inference/snap/hints. Every top finding was independently verified (two bugs were found by two agents independently; three more were spot-checked by hand). File:line anchors are working-tree current.

**Legend:** 🔴 bug-high · 🟠 bug-medium · 🟡 bug-low · ▫ deficiency vs SolidWorks.

---

## Confirmed bugs, ranked

### 🔴 B1. Negative-dimension flip can teleport the ORIGIN or a fixed anchor
`cad/lib/store.ts:1131-1166` (`setDimensionValue`) — found independently by two reviewers; new in the 07-08 batch.
The flip reflects a **hardcoded target slot** (targets[1] for h/v-distance; the point for point-line), not the *free* side. Which point sits in that slot is pure click order. The origin and `fixed` points are pinned *at their stored coords*, so reflecting one physically relocates the anchor and the solver blesses it.
**Repro:** dim P(5,0)→origin picked in that order (origin = targets[1]), value 5; type −5 → the origin entity moves to (10,0), P never moves, every origin-anchored relation now anchors at a phantom point while the origin marker renders at (0,0). SW flips the free side and never touches an anchor. `dimension-flip.spec.ts` only tests the favorable ordering, so CI passes.
**Fix shape:** pick the reflect target by freedom — prefer the target not fixed/origin/on-edge-anchored (use `determinedEntities`/fixed-set); if both anchored, reject the flip (SW shows the over-defined dialog).

### 🔴 B2. Determinacy's sin-based angle residual has zero gradient at 90°
`cad/lib/determinacy.ts:642` (3-point, new) and `:651-653` (2-line, pre-existing).
Residual `sin(φ) − sin(target)` has Jacobian `cos(φ)·∂φ`; at a solved right angle `cos(90°)=0` → the whole row is FD noise → **a 90° angle dimension determines nothing** in the rank analysis. Solver says DOF 0 / green; per-entity coloring stays blue; `_dimensionWouldBeRedundant` misses redundancy → the over-define prompt doesn't fire and Fully Define adds spurious dims. The *edge*-angle mirror already uses the immune form `|atan2(cross,dot)| − |value|` — the internal cases should switch to it. (Same class, rarer: zero-valued h/v-distance dims use `dx² − v²`, gradient 0 at v=0 — `determinacy.ts:484-495`; note Fully Define already sidesteps this by emitting alignments for zero offsets.)

### 🔴 B3. `splitLineAt` tears shared topology and drops all relations
`cad/lib/sketchEditOps.ts:1219-1240` (pre-existing; verified by hand).
It deletes the line then **unconditionally mints fresh endpoints**, unlike the new `splitArcAt`/`splitCircleAt` (which reuse survivors and inherit direction constraints). Split a rectangle's side → two sub-lines on duplicate corner points, the adjacent sides still on the old corners, the `horizontal` gone; drag a corner and the rectangle tears. Fix: rebuild it on the `splitArcAt` pattern (acquireOrCreatePoint + `inheritConstraintsOntoMultiple`).

### 🔴 B4. All four slot tools emit duplicated, fully unconstrained topology
`cad/lib/store.ts:662-807` (pre-existing).
Rails get their own points; caps are built via `addArc`, which mints *fresh* center/start/end points at the same coords — 4 coincident-by-position duplicate pairs with **no coincident constraints and zero relations** (no tangent, equal-radius, parallel, concentric). Drag a rail endpoint → the slot tears open. (`_addSlotArc`'s four explicit points are complete orphans.) The cap/winding *math* is correct — the topology/constraint layer is the failure. SW slots stay slots and need only length/width/position dims. Fix: share endpoint ids between rails and caps (or coincident-constrain), add tangent ×4 (implied by shared points + perpendicular caps in SW; minimally: equal-radius cap↔cap, parallel rail↔rail, concentric for arc slots).

### 🟠 B5. `ridesGeometry` H/V stacking can commit contradictions (07-08 change)
`components/cad/cad-sketch-editor/cad-sketch-editor.component.ts:2417-2445`.
When a line's endpoint snaps onto a curve/edge, the endpoint comes from the pick projection but the H/V offer comes from raw-cursor inference — with **no feasibility check**. The inference engine's own on-curve H/V enrichment requires the curve∩axis intersection to be near the cursor and refuses arcs/circles outright; the commit path bypasses both guards. On an arc with no `y = start.y` intersection this commits an unsatisfiable pair (instant red); on shallow lines the endpoint can teleport to a far intersection. Fix: apply the engine's guard — only stack H/V when the snapped curve actually intersects the axis line near the click (and never for arcs/circles unless the intersection exists), i.e. reuse the enrichment logic rather than the plain H/V branch.

### 🟠 B6. Inference badges and click commits use different rulers (systemic)
`cad/lib/inference.ts:70` (`LINE_SNAP_TOL = 2`, fixed sketch units) vs zoom-adaptive pick tolerances (`PICK_PX=5`/`POINT_PICK_PX=8`). Zoomed out, commits ride curves the hover never announced (this arms B5, and silently swaps a previewed tangent/⊥/∥ for a bare on-curve pin — the `:2445` filter keeps only h/v). Zoomed in, "on line" badges show in a band where a first click commits nothing. Fix: derive inference tolerances from the same zoom-adaptive source the picker uses, and make the commit consume the same inference result the preview rendered.

### 🟠 B7. Chamfer commit records a pinned solve as global sketch state
`cad-sketch-editor.component.ts:3816-3818` (verified by hand). `commitWithMovable` solves with everything-else force-pinned and passes that result to `_recordSolve`: the DOF readout shows green "fully constrained" for an under-constrained sketch, and force-pinned constraints get diagnosed redundant → REQ 887 amber false-positives on legitimate constraints. Fix: don't record diagnostics from movable-pinned solves (mirror the drag path).

### 🟠 B8. Trim on circles/arcs rewires ALL constraints (passengers included) onto one kept piece
`cad/lib/sketchEditOps.ts:590-765`. No direction-class filter (contrast `splitLineKeepingOnly`): a passenger point at 170° gets welded to the [0°..45°] piece and snaps ~120° on solve; an `arc-length` dim inherited onto a different-sweep piece goes inconsistent. Fix: inherit direction-class + on-edge only; re-attach passengers by angular range (the split ops already do this correctly).

### 🟠 B9. Any point near a circle's circumference becomes a trim boundary — and gets welded in
`sketchEditOps.ts:793-813, 859-875`. Foreign points (other circles' centers, the origin) within tolerance of the circumference count as cut markers, and `resolveEndpoint` **reuses the foreign point id as the new arc endpoint** — structurally welding unrelated geometry (vesica case: trimming circle A grabs circle B's center as an endpoint). Also a T-junction double-counts (pointId + curveId at the same angle) defeating the `< 2` hits guard. Fix: only accept points that are actually coincident-constrained onto the curve (or entity endpoints lying on it), dedupe hits by angle.

### 🟠 B10. Full-360° circular sketch pattern stacks the last clone on the original
`sketchEditOps.ts:4316-4341` (verified by hand): `step = total/(count−1)` with the documented "pass 2π" convention → clone N lands at 0°. 360°/4 gives 0/120/240 + duplicate, not 0/90/180/270. Fix: full-circle special case (`step = total/count` when `|total| ≈ 2π`).

### 🟠 B11. Arc fillets lack the oversized-radius guards the other paths have
`sketchEditOps.ts:3186-3326, 3425-3501`. Line-line fillet and line-arc *chamfer* reject radii that push tangent points past a leg/sweep; `filletLineArc`/`filletArcArc` never check → silent geometry corruption (line reverses; arc `ccw` becomes the reflex complement). The spec's tangency assertion accepts either tangency type/root side, so a wrong-side fillet passes.

### 🟠 B12. Fillet of a dimensioned corner leaves the dim on a floating point
`sketchEditOps.ts:3332-3401, 3727-3804`. If the corner point carries a constraint it's kept but re-pinned to nothing — a free 2-DOF point the old dim still measures. SW makes a virtual sharp. (The line-line `keepRemovedAsConstruction` mode already builds one — make it the default behavior when the corner is constrained; extend to line-arc/arc-arc.)

### 🟠 B13. Ellipse axis-crossing clamp silently destroys the minor radius
`cad/lib/solver.ts:529 + 581-583` (07-08 batch). Drag the major-axis end inside the minor radius: `radmin = min(b, a)` is clamped then **persisted by readBack** — the user's minor radius is gone with no feedback. SW flips major/minor. Also `pinAllRadii` doesn't pin ellipse `radmin` (drag parity gap).

### 🟠 B14. Mirrored chains come out topologically shredded
`sketchEditOps.ts:1468-1558`. Shared endpoints reflect once per incident entity → stacked duplicate points, no shared ids/coincidents (geometry only tracks via per-point `symmetric`). Also skips ellipses/splines silently and drops the `construction` flag on copies.

### 🟡 B15–B22 (low, verified by review)
- **E3 ride ids unmappable** (`solver.ts:700` vs the id mapper): `_extrefC_<cid>-<pid>`'s captured suffix is never re-tested against the `-` rule → conflicts/redundancies involving diagonal converted-line rides are silently dropped from the highlight set. (Also predicted independently before the review ran.)
- **Axis-aligned converted lines double-constrained** (h/v fallback + E3 ride) → permanent phantom amber "redundant" on the Convert link. Skip the h/v when the ride is active, or extend the redundancy filter.
- **Determinacy on-edge pre-fix doesn't mirror the solver's skip** for circle/arc anchors and no-projection cases (`determinacy.ts:129-150`) → false "determined" readouts.
- **Missing-target guards inconsistent** in `translateConstraint` (h/v-pp, distance, perp/parallel, midpoint, symmetric emit `''` ids on dangling refs → push throws → sketch silently stops solving).
- **Trim invents h/v relations** on coincidentally axis-aligned unconstrained lines (`sketchEditOps.ts:414-425`) — synthesizes intent SW wouldn't.
- **Preview/commit mismatch on point snaps**: hover shows an H/V badge + rubber line to the H/V position while the commit does coincident-only to the snapped point (`cad-editor.component.ts:7714-7756`).
- **`midpointOf` missing from the snap tests** in handleLineClick → redundant coincident+midpoint pair (instant amber) and possible commit-time jump.
- **Kind gaps:** `scaleEntities` misses `ellipticalArc.minorRadius`; `copyEntities` drops ellipticalArc/conic/text silently; `setConstructionFlag` cascade misses ellipticalArc/conic points; `mergePoints` doesn't remap `conic.pointIds`; parallelogram's two `equal`s are redundant-by-construction; constraint list's `HAS_VALUE` omits `radial-distance` (no value button); `rotateTextBox` level test `norm % 180 < 0.5` misses 179.8°/359.8° (should be `min(m, 180−m)`); edge-angle dims depend on projected endpoint order (reversed re-projection drives the supplement).

---

## Deficiencies vs SolidWorks (no code defect — capability gaps)

**Relations / diagnosis**
- **No dangling-relation detection anywhere.** A relation whose external ref no longer resolves is silently inert and renders healthy. SW colors dangling olive + offers repair/replace. Highest-value single deficiency in the constraint system.
- No SketchXpert equivalent (conflict sets are highlighted, but no suppression-set suggestions).
- No pierce; no point-on-spline/tangent-to-spline (spline curves themselves are unconstrainable); parabola registered but no point-on/tangent mapping (coincident falls through silently for `conic`); conic/spline/ellipticalArc never roll up "determined"; re-driving a driven dim doesn't re-raise the over-defined dialog.

**Inference / hints**
- No automatic-relations settings toggle and no suppress key (SW: Ctrl while drawing).
- No visual distinction between "will add a relation" (SW yellow) and "guide only" (SW dashed) — both render as the same badge; the ┃/━ alignment label is a dead ternary (`inference.ts:474`).
- No inference during drag (SW shows relation icons mid-drag and adds on release); drag-drop adds no relations.
- No tangent inference when a line starts at an arc *endpoint* (the most common SW tangent inference) — the coincident is point-point, so `tangentFromStart` never sees the curve.
- ~12 tools show snap indicators but commit no snap constraints (slots ×4 — not even slot-axis H/V, polygon, 3-pt rects, parallelogram, circle-3pt, arc-3pt, ellipse, spline; rounded-rect doesn't even pin external refs). SW infers coincident/H/V on essentially every click of every tool.
- `orientationSnap` over-fires (any of N reference lines mod-90° within 5° — a dense sketch commits ∥/⊥ to arbitrary distant lines and polar tracking never fires); SW gates to the recently-highlighted reference.
- Badge stacking is zoom-unstable (sketch-unit offsets; `constraintIcons.ts` documents the right pattern).
- Angle/tangent-to-edge rows don't indicate the model edge in the constraint list.

**Tools**
- No power-trim (drag across entities); extend ignores construction boundaries while trim honors them (inconsistent, and SW honors both); trim-on-construction has no preview.
- `addPolygon` emits zero constraints (no equal-sides chain / construction circle — dragging any vertex destroys the regular polygon; internally inconsistent with rectangles which do auto-constrain).
- Fully Define: 50-iteration budget = 50 entities (large sketches exit `partial` with only a console.warn); PlaneGCS-redundant additions are kept (not rolled back); blacklisted entities leak their already-committed dims; curve radius dims placed near the origin; ellipses/splines never dimensioned → always `partial` when one is free.

---

## What's solid (verified-correct highlights)

- The **inference engine itself** is internally consistent — every offer agrees with its displayed snap; refusals (arcs for H/V enrichment, polar no-constraint) are principled. All top hint bugs live in the **component commit wiring**, not the engine.
- **Ellipse/parabola solver registration adds no phantom DOF** (9 params − 4 alignment equations = 5 true DOF); all vendored primitive field names spot-checked correct; arc_rules + determinacy's arc invariants correct.
- Redundancy query ordering/filtering correct for the pin families; driven dims genuinely inert everywhere; the three `isOtherwiseConstrained` copies agree; constraint-id prefix mapping is structurally collision-safe.
- Extensive hand-verified math: line-line/line-arc fillet geometry, chamferLineArc's angular walk, extendArc's nearest-boundary parameterization, split bracket math, slot cap winding, offsetChain corner reconciliation, rotate/scale/mirror ccw handling.
- `_lastRawClick` plumbing, quadrant snaps, armed-ref alignment precedence, and external snap ranking are consistent between preview and commit.

## Suggested fix order (value ÷ effort)

1. **B1 dimension-flip anchor selection** (S — pick the free side; the spec gains the reversed-order cases) + **B7 chamfer `_recordSolve`** (S — drop the record) + **B10 360° pattern** (S) + **B2 angle residual → atan2 form** (S).
2. **B5+B6 commit/preview unification** (M — one inference result, one tolerance source, engine feasibility guard; fixes three finding-classes at once).
3. **B3 splitLineAt on the splitArcAt pattern** (S-M) + **B8/B9 trim inheritance + boundary filtering** (M).
4. **B4 slot constraints** (M — shared cap/rail points + relations; also unlocks "slots stay slots").
5. **B11/B12 fillet guards + virtual sharp** (M).
6. Dangling-relation detection (M-L — the biggest SW-parity win in constraints).
7. The 🟡 batch as ride-alongs.
