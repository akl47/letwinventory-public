# CAD Module vs SolidWorks / Onshape — Divergence Review (2026-07-02)

Six parallel review agents compared each CAD subsystem's actual code behavior against
SolidWorks and Onshape conventions. Every claim below was verified against the code
(file:line cited). This is an assessment, not a fix list — items marked **[BUG]** are
shipped defects discovered along the way; the rest are convention divergences ranked by
how hard a SW/Onshape user would notice.

## Executive summary

The architecture deliberately mirrors the references and mostly succeeds: SW-style MMB
navigation with cursor-anchored zoom, a 26-region nav cube, Onshape-style region picking
for extrude profiles, a real rollback bar + drag reorder, per-feature content-addressed
regen caching, PlaneGCS constraint solving with live inference/dragging/driven dims,
SW-style entity-pair mates with a genuine LM/DOF solver, and a PDM checkout/checkin +
release model that out-does both references in release-geometry immutability (frozen
BReps, write-once tags).

The deepest divergences, ranked:

| # | Divergence | Area | Severity |
|---|---|---|---|
| 1 | **No STEP/STL import anywhere** — every vendor part must be remodeled by hand before it can be mated | Assembly/IO | Critical |
| 2 | **Merge has no 3-way base** — default ticks can revert main-only edits, delete main-added features; branch equation edits silently dropped, feature order lost | PDM | High |
| 3 | **Topological naming: positional edge ids** + geometric fallbacks vs true history-based naming (known: breaks on-edge projection, chamfer refs after merges) | Kernel | High (architectural) |
| 4 | **Hide (eye icon) = suppress in regen** — `visible === false` skips the feature from the boolean chain; SW hide is render-only, and solid features can't be hidden at all | Tree/regen | High (semantic) |
| 5 | **No conflict diagnosis on over-constraint** — whole sketch turns red + generic toast; SW has SketchXpert, Onshape highlights the specific conflicting constraints | Sketcher | High |
| 6 | **Checkout locks: no renewal, 30-min TTL, silent takeover inherits the prior user's dirty edits**; single shared working copy = no concurrent work across branches | PDM | High |
| 7 | **No box/window selection in the 3D viewport** (LMB-drag consumed by navigation) | Viewer | Med-High |
| 8 | **Drag with free DOF is unconstrained** — mated hinge translates freely during the gesture, snaps back on release; SW/Onshape animate along remaining DOF live | Assembly | Med-High |
| 9 | **Mandatory invisible 1 mm integer-grid snap** in the sketcher, no toggle, no visible grid | Sketcher | Medium |
| 10 | **Merge target hardcoded to most-recent body**, no per-feature body-scope picker (SW Feature Scope / Onshape Merge scope) | Features | Medium |

Shipped bugs found (not convention questions):

- **[BUG] Rename silently no-ops for every feature type except additive extrude** — stale `feature.type !== 'extrude'` guard (editor ~12177) while the context menu offers Rename on all kinds. High.
- **[BUG] Loft features render no tree row at all** — no `f.type === 'loft'` branch in `_appendFeatureNodes`; a loft is invisible/unmanageable in the tree. High.
- **[BUG] Sketch-delete dependency scan misses sweep and loft** (editor ~12726 checks only extrude/cutExtrude/revolve/cutRevolve) and cascade delete misses loft (`featureTree.ts:108-124`) → silent dangling refs. High.
- **[BUG] Exploded views are a dead backend stub** — endpoints + serializer exist, but regen never reads `doc.explode` and the frontend has zero references. High (API/feature mismatch).
- **[BUG] Mirror-pattern copies export/interference-check as the *unmirrored* seed geometry** (`assemblyRegenService.js:579-582`). High if mirror patterns are used for deliverables.
- **[BUG] Right-click on a dimension label deletes it immediately** — no context menu, no confirm (`cad-viewer.component.ts:4826-4831`). Med-High accident risk.
- **[BUG] `sweepExpiredLocks` defined but never called in production** (`cadVcsService.js:217`). Low.
- Drift bugs from the twin visible/suppressed flags: regen progress HUD over-counts suppressed features (editor ~13373); dangling-host scan skips suppressed but not hidden (`cadRegenService.js:1008`). Low each.
- Stale header comment in `cadRegenService.js:18-19` ("upstreamHash is always ''" — false since the compose cascade). Trivial.

---

## 1. Sketcher

**At/above parity (verified present):** rubber-band previews for every tool; constraint
inference while drawing (coincident/point-on-curve/midpoint/quadrant/H/V/tangent + polar
tracking at SW's 15°); live constraint-solved dragging with warm-started async solves;
driven dims in parentheses; per-entity under/fully-defined coloring via Jacobian rank;
double-click inline dimension editing; trim/extend/split/offset/mirror/dynamic-mirror/
fillet/chamfer/jog/move/copy/rotate/scale/stretch/patterns/Convert Entities/text/pictures;
`=expression` equation dims with Σ prefix; live DOF readout (superset of both references);
Tab tool-variant cycling; SW-community letter hotkeys. Construction geometry is now purely
visual (the old radius/point pinning was removed) — matches SW/Onshape semantics.

**Divergences:**
- **No conflict diagnosis (High).** Solver `inconsistent` → whole sketch red +
  generic toast; the offending constraint is committed and kept
  (`cad-sketch-editor.component.ts:3935-3952`, `cad-viewer.component.ts:5233-5238`).
  SW: over-defining dialog at add time + SketchXpert. Onshape: specific conflicting
  constraints render red.
- **No manual driven↔driving toggle (Medium).** `driven` is set only automatically at
  creation when targets are already determined; no UI to flip an existing dim.
- **Redundant driving dims silently convert to driven (Medium)** — no "make driven?"
  choice point (SW asks; Onshape refuses and flags).
- **No crossing (right-to-left) box selection (Medium)** — one enclosed-only rule
  regardless of drag direction (`:2122-2135`).
- **`window.prompt` for toolbar dimensional constraints (Medium)** — hardcoded default
  '10'/'45°', not the measured value; rotate/scale/pattern/polygon params too. The
  inline-editor infrastructure already exists on the smart-dim path.
- **1 mm integer-grid snap on all new geometry and drag commits, no toggle, no visible
  grid (Medium)** (`:1774-1780`, `:2049-2054`). SW/Onshape: continuous coords.
- **Circle/arc rim drag never resizes (Medium, deliberate)** — drag moves center only,
  radii pinned during drag (`solver.ts:521-525`); SW/Onshape resize on rim drag.
- **No perpendicular/parallel/equal inference while drawing (Low-Med).**
- Trim refuses construction geometry; no power-trim drag (Low). Green (not black) for
  fully-defined (Low, defensible on a dark viewport). ~400 ms-debounced undo granularity
  (Low, intentional).

## 2. 3D features

**Kernel ops:** extrude, loft, boolean, revolve, sweep, shell, edge-blend (fillet+chamfer),
3 pattern ops, volume, STL/STEP export (`main.cpp:147-159`, NAMING_VERSION 45).

**At/above parity:** extrude end/start conditions nearly complete (blind, midPlane,
throughAll, upToVertex/Surface/Body/Next, offsetFromSurface; SW-style start-from; full
two-direction with independent conditions); patterns excellent (feature-seed vs body-seed
+ SW `geometryPattern` semantics); fillet/chamfer strong (multi-edge, per-edge values,
tangent propagation via G1 BFS, face-pick expansion, all 3 chamfer modes, full-round
workaround); hole feature is genuinely spec-driven (ISO 273/4762/7991 + ANSI B18.x, 4
types, cosmetic threads); rollback + reorder feature-complete; per-feature failure
isolation with human-actionable errors; Onshape-style region picking via full planar
arrangement (DCEL face-walk, nested regions).

**Divergences:**
- **Topological naming (High, architectural).** Faces get semantic persistent names, but
  edges/vertices are positional indexes (`geom_io.cpp:1051`) that reshuffle on merge; fuse
  re-tags all faces under the composing feature. Compensated by geometric identity
  everywhere (endpoint-pair edge refs, fallback planes, centroids), but refs still go
  stale and require re-picks. SW/Onshape maintain true history-based naming.
- **Merge target hardcoded to most-recent body; cuts always all-bodies; no scope picker;
  no per-feature Intersect (Medium)** (`cadRegenService.js:710-732`).
- **Revolve axis must be a sketched line in the same sketch (Medium)** — no datum-axis or
  model-edge axis, no mid-plane/two-direction revolve (documented MVP limitation).
- **Hole placement is click-a-face only (Medium)** — no sketch-driven positions, no drill
  tip angle (blind = flat-bottom), narrow fastener coverage, no modeled threads.
- **Sweep/loft basic (Medium)** — no guide curves, twist, tangency, point profiles.
- **Missing features: draft angle (extrude + standalone), thin feature, rib, variable-
  radius fillet, face fillet, curve/sketch/table-driven and fill patterns, instance skip
  (Low-Med).**
- **Region-index persistence across two independently-implemented extractors (frontend
  arrangement.ts / backend cadArrangement.js) is fragile (Medium)** — an upstream region-
  count change silently shifts which region an old feature extrudes (known standing risk).
- Reorder lacks dependency validation (matches Onshape's fail-at-regen, not SW's blocked
  drop). No error-vs-warning tier on tree markers.

## 3. Feature tree / regen / history UX

**At/above parity:** rollback bar (draggable, context-menu roll to/forward, insert-at-bar,
auto-rollback during feature edit); drag reorder; suppression (`suppressed`, SW-style);
per-feature content-addressed BRep cache with upstream-hash cascade (functionally SW's
"rebuild from edit down"); streaming per-feature WS results; configurations with design-
table grid (equation overrides + tri-state suppression, assembly config pinning); multi-
body split tracking with centroid identity; sketch sharing with frozen external-ref states
at first consumer (subtle correctness win); Cascade/Break/Cancel sketch delete; dangling
host-face re-pick affordance (nicer than SW's).

**Divergences:**
- **`visible === false` skips regen — hide == suppress (High semantic).** SW hide is
  render-only and applies to bodies, not solid features. Correct fix: make feature-level
  `visible` render-only (body visibility already is) or drop it in favor of `suppressed`.
- **Rollback position is client-transient (Low-Med)** — reload silently rolls forward;
  SW/Onshape persist it.
- **Equations live outside the undo snapshot (Medium)** — equation edits aren't undoable
  and undo can strand equation refs.
- **No body rename (backend always emits `name: null`); body visibility transient
  (Medium).** Inverted vs SW where hide-body is the persisted control.
- **Delete Body is destructive** (drops root feature + everything after, with confirm);
  SW/Onshape model it as a parametric Delete Body/Part *feature* (Med-High).
- No double-click-to-edit on tree rows or Instant3D-style viewport dim editing (Low-Med);
  no Parent/Child dialog (Medium); rename via `window.prompt` not inline (Low).
- Full-tree walk per regen (cache-hit features still re-ship tessellations) — heavier
  constant factor than SW in-process rebuild (Low-Med at large trees).

## 4. Viewer / input

**At/above parity:** SW-style MMB orbit + Ctrl/MMB drag-zoom; cursor-anchored wheel zoom
(correct ortho math); 26-region nav cube with hover highlight, drag-orbit on the cube,
click = animated orient + fit; 90° roll buttons; arrow-key 15°/Shift-90° rotation;
Normal-To; auto normal-to on sketch entry with gravity-aligned up + orbit-releases-pin
(exactly Onshape's nuance); hover preselect with back-face depth rejection; 6 display
modes incl. hidden-dashed (richer than Onshape); Measure tool; SW-style selection-list
boxes; saved default views; snap glyphs + alignment guides.

**Divergences:**
- **No box/window selection in 3D (Med-High)** — LMB-drag is consumed by navigation;
  rubber-band exists only in the 2D sketcher.
- **Section view is assembly-only and axis-aligned-only (Medium)**; part studio has none.
- **No view hotkeys (Medium)** — no Ctrl+1..7, Ctrl+8, F-fit, n; sketch `F` = Fillet tool
  collides with SW fit muscle memory.
- Shift+MMB pan (SW uses Ctrl+MMB); no RMB orbit for Onshape users (Low-Med).
- No Select-Other/Alt-click cycling; datum planes overlapped by the body are unclickable
  in plain select (face-prefers-datum rule; tree is the workaround) (Low-Med).
- Sketch additive select is Shift (SW/Onshape: Ctrl); ctrl not forwarded on sketch clicks
  (Low-Med). Thin RMB menu, nothing on empty-space right-click (Low-Med).
- No wheel-invert setting, no user-facing selection-filter toolbar, no mass/inertia from
  density (Low).

## 5. PDM / versioning

**Model:** deliberately the SW-PDM side of the spectrum (exclusive checkout/checkin,
revision schemes, approval workflow) executed faithfully — every check-in is a commit,
any commit viewable/openable read-only with per-commit thumbnails, frozen-BRep releases
with write-once tags (identical geometry per release *by construction* — stronger than
either reference), branch-from-any-commit, cherry-pick, competitive diff UX (locked-camera
side-by-side, face-level coloring, constraint-level sketch diff).

**Divergences / defects:**
- **Locks (High):** 30-min TTL, no renewal heartbeat, `lockExpiresAt` never read by the
  frontend, no expiry warning. Checkout after expiry silently inherits the prior user's
  dirty autosaved edits (`vcsWorkingCopy.js:67-73`); the prior user's saves then 423 as
  toasts while the editor keeps accepting doomed edits.
- **Single shared working-copy row (High):** two users can't work/view different branches
  concurrently; a URL-driven branch switch in one window flips the branch under another.
  Onshape branch vocabulary without Onshape isolation.
- **Merge has no 3-way base (High):** the picker diffs mainHead↔branchHead two-way with
  all entries ticked by default → main-only edits mislabeled "changed on branch" and
  reverted; features added on main default-deleted; both-sides edits silently lose one
  side; branch equation changes aren't even listed and are always dropped
  (`cadBranchService.js:157`); merged-in features append to the end of the tree (feature
  order is semantic). Onshape does a true 3-way merge with explicit conflicts.
- **Check-in always releases the lock (Medium)** — no SW-PDM "keep checked out"; each
  checkpoint costs a checkout round-trip, discouraging frequent commits.
- **No direct restore/revert to an arbitrary commit (Medium)** — button disabled "Coming
  soon"; branch-from-commit is the workaround.
- **Double-click release race (Medium)** — staggered duplicate requests can mint two
  consecutive Part revisions of identical geometry or orphan an unlocked Parts row; no
  frontend busy-guard; raw Sequelize error on the unique-index path violates the
  error-message rule. Also `derivedDraftRev` (locked rows only) can disagree with
  `nextNumericRevision` (all rows) → badge shows 02, release mints 03.
- Autosave (500 ms debounce) makes crash-loss minimal — closer to Onshape than SW PDM —
  but there's no per-action history between check-ins and failed saves only toast
  (Low-Med).

## 6. Assemblies / import / export / drawings

**At/above parity:** SW-style entity-pair mates (9 types incl. origin), all creatable
gated by kernel surface classification; real Levenberg–Marquardt DOF solver, server-
authoritative, with auto flip-repair and under/fully/over state; in-context editing with
live cross-part refs resolved in dependency order, cycle degradation, staleness badges;
recursive sub-assemblies with cycle rejection; component patterns; per-instance branch
+ configuration pinning (exceeds both references); interference detection (AABB + kernel
boolean confirm); BOM aggregated per part+config **synced into the inventory
BillOfMaterialItems table** (neither reference does this natively); frozen-release STEP
export.

**Divergences / defects:**
- **STEP/STL/IGES/DXF import completely absent (Critical).** No reader op in the kernel,
  no backend route. Every purchased component must be remodeled before it can be mated —
  the single largest cap on the assembly module's practical value. OCCT ships
  `STEPControl_Reader`; the hard part is a "body-only, no feature tree" model kind.
- **No kinematic mates or motion** (revolute/slider/pin-slot/limits/gear) — motion exists
  only as leftover DOF (Medium).
- **Drag ignores mates during the gesture** (camera-plane translation, solve-snap on
  release); the frontend solver kept "for interactive drag" is never invoked mid-drag
  (Med-High UX).
- **Exploded views: dead stub** — API + serializer only; regen never applies it; zero
  frontend references (High).
- **Mirror-pattern copies use unmirrored seed geometry for export + interference**
  (High if used). Pattern UI hardcodes circular axis to Z-through-origin and mirror to
  principal planes (Medium).
- Sub-assemblies are rigid only (no SW Flexible) (Medium). Mass = volume + COM only, no
  density/inertia (Medium). Interference reports no volume (Low-Med).
- **BOM sync is a destructive replace** — deletes manually curated BOM rows (Medium
  footgun).
- **Assembly STEP export is flat/structureless** — one compound, no product hierarchy,
  no instance names/colors; `clean_unify` over the compound can merge faces of touching
  components (Med-High for supplier round-trips).
- **STL tolerance not exposed** — live STL is the display mesh dumped client-side;
  release STL uses the kernel's 0.01 mm default which the backend never overrides
  (Medium; 3D-printing users expect deviation/angle controls).
- **2D drawings absent** — no sheets/views/GD&T/title blocks (High in the abstract;
  partially offset by the EngineeringMasters work-instruction system).
- Non-plane/cylinder surfaces (cones, spheres, tori, splines) silently unmateable (Info).

---

## Where this module *beats* the references

- Release-geometry immutability by construction (frozen BReps + write-once tags).
- CAD→ERP BOM sync into inventory.
- Per-instance branch/config pinning in assemblies.
- Live DOF readout in the sketch toolbar; green fully-constrained tree lock indicators.
- Shared-sketch external-ref freezing at first consumer.
- Region-skip resilience inside a multi-region extrude (sibling regions still build).
- Constraint-level sketch diff + camera-locked side-by-side 3D compare.
- Hidden-line display modes Onshape lacks; drag-orbit on the nav cube.
