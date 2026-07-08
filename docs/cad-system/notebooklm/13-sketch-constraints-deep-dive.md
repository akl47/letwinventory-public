# Sketch Constraints: A Deep Dive

This document is a deep technical examination of the 2D sketch constraint system — the machinery that turns "these two lines are perpendicular and this one is 40 millimeters" into exact coordinates. It covers the constraint data model, the complete constraint catalog and how each type translates into solver primitives, the vendored PlaneGCS solver and its lifecycle, external references to 3D model geometry, the two independent diagnosis systems (degrees of freedom and conflict identification), the toolbar and inference layers that create constraints, and the honest gaps. It assumes familiarity with the sketching overview (entities as tagged unions, the render/solve/pick split) and drills into the constraint layer specifically.

---

## A Constraint as Data

Every constraint in a sketch is one record: an id, a `type` string from a closed union of about two dozen types, an ordered list of `targets`, and a handful of optional fields. A target is `{ entityId, sub? }` — a reference to an entity, optionally qualified by a sub-element name (`start`, `end`, `center`, `edge`). Dimensional constraints carry a `value` in millimeters. A `driven` flag turns any dimension into a reference annotation. A `placement` field remembers where the user parked the dimension label. An `angleRays` field on angle dimensions persists which quadrant of the corner the dimension measures. An `externalRef` field, when present, means one side of the constraint is not sketch geometry at all but a projection of 3D model geometry — the mechanism that lets a sketch lean on the solid model around it.

The order of targets matters and is canonicalized at creation time, not at solve time: type-asymmetric constraints (point-on-line, midpoint, symmetric, point-to-line distance) are reordered point-first when the user's click order was the other way around, so the translation layer can assume a fixed shape.

---

## The Constraint Catalog

The translation from user constraints to solver primitives happens in one function, `translateConstraint`, which returns an **array** of primitives — zero, one, or several per constraint. The catalog divides into four translation categories.

### Direct, one-to-one

The simple cases hand off cleanly to a single PlaneGCS primitive:

- **horizontal** — on a line, `horizontal_l`; on two points, `horizontal_pp`. Vertical mirrors this (`vertical_l` / `vertical_pp`).
- **perpendicular** — `perpendicular_ll` between two lines.
- **parallel** — `parallel` between two lines.
- **distance** — `p2p_distance` between two points.
- **point-line distance** — `p2l_distance`.
- **radius / diameter** — `circle_radius` / `arc_radius`, `circle_diameter` / `arc_diameter`. Radius and diameter are kept as distinct types rather than converting one into the other, so the dimension's history and display match what the user actually placed.
- **arc length** — `arc_length` on an arc.

### Dispatch-by-kind

Some user concepts are one button but several different equations depending on what is selected:

- **coincident** sorts the point first, then dispatches: point+point → `p2p_coincident`; point+line → `point_on_line_pl`; point+circle → `point_on_circle`; point+arc → `point_on_arc`; point+ellipse → `point_on_ellipse`. The legacy `point-on-line` and `point-on-curve` constraint types were folded into this one `coincident` type; the migration layer rewrites old documents on load.
- **tangent** has six variants selected by the pair of entity kinds: line/circle (`tangent_lc`), line/arc (`tangent_la`), line/ellipse (`tangent_le`), circle/circle (`tangent_cc`), arc/arc (`tangent_aa`), circle/arc (`tangent_ca`). The dispatcher tries both orderings, so selection order does not matter.
- **equal** has four: line/line → `equal_length`; circle/circle → `equal_radius_cc`; arc/arc → `equal_radius_aa`; circle/arc → `equal_radius_ca`.

### Synthesized, one-to-many

Several high-level constraints have no single PlaneGCS primitive and are composed from two, with synthetic ids suffixed from the parent constraint's id so they can never collide with an entity id:

- **midpoint** = `point_on_line_pl` (`c42-onl`) + `point_on_perp_bisector_pl` (`c42-pb`). On the line *and* on its perpendicular bisector is exactly the midpoint.
- **symmetric** = `midpoint_on_line_pppp` (the midpoint of A and B lies on the axis) + `perpendicular_pppp` (segment A→B is perpendicular to the axis), built from the axis line's endpoint ids.
- **concentric** = `p2p_coincident` of the two center points.
- **coradial** = concentric (`-cc`) + the appropriate equal-radius primitive (`-r`).
- **collinear** = `parallel` (`-par`) + `point_on_line_pl` of one line's start point on the other line (`-onl`).

The suffix convention is load-bearing: when the solver later reports *which primitives* conflict, those synthetic ids must be mapped back to the user's constraint — the mapping recognizes exact ids, `-suffix` forms, and the `_prefix_` forms used by the solver's own synthetic geometry.

### The subtle dimensional cases

- **angle** uses `l2l_angle_pppp` — the four-explicit-points form rather than the two-lines form — because orientation must be controllable. Two subtleties: the translation orients both direction vectors *away from the shared vertex* so the interior corner angle is targeted (matching what the measurement tool reports), and because PlaneGCS angles are signed, the target's sign is corrected to the current geometry's sense so the solver rotates the short way rather than 350 degrees the long way. A persisted `angleRays` pair of signs locks which quadrant the user dimensioned, so re-solving never flips the dimension to the supplementary angle.
- **horizontal-distance / vertical-distance** use the `difference` primitive on the x or y coordinate alone, signed by the current relative position of the two points.
- **radial-distance** (the gap between two concentric curves) is a `difference` between the two entities' radius properties — outer minus inner equals the value.
- **chord-distance** on an arc emits no new geometry at all: it is a `p2p_distance` between the arc's existing start and end points, reusing the arc's first-class endpoints.

### Driven dimensions emit nothing

A dimension flagged `driven` is skipped entirely at translation. It renders in parentheses, updates its displayed value from measured geometry, and contributes zero equations. This is what makes over-annotation safe: a redundant chord dimension next to a controlling radius can never push the system into inconsistency, because the solver never sees it. When a dimension the user places would be redundant with existing constraints, the editor drops it in as driven automatically rather than refusing it.

---

## PlaneGCS: The Engine

### What it is and why it is vendored

PlaneGCS is the planar geometric constraint solver that ships inside FreeCAD — a C++ Newton-family solver with analytic Jacobians, hardened by years of production sketching. The system uses a WebAssembly build (`@salusoft89/planegcs`), **vendored** into the repository rather than installed from npm: the WASM binary, the Emscripten loader, and the typed primitive catalog live under `frontend/src/app/cad/vendor/planegcs/` with a `PROVENANCE.md` recording the exact upstream version and update procedure. Vendoring insulates a load-bearing dependency with a single upstream maintainer against unpublishing, takedown, and version drift. The LGPL license is honored through the WASM substitution surface — `planegcs.wasm` is a swappable file loaded dynamically, so a user can drop in their own build of the library.

The solve algorithm requested is **DogLeg** — a trust-region method that blends the aggressive Newton step with a safe gradient step, choosing per-iteration based on how trustworthy the local model looks. The solver reports one of four statuses; only `Success` and `Converged` are treated as success.

### Building the primitive set

Before each solve, the sketch is translated into PlaneGCS's vocabulary. Points are emitted as `{x, y, fixed}`; lines reference their endpoint ids; circles carry a center id and radius; arcs carry center, start, and end ids plus a radius and start/end angles computed from the current coordinates.

Three details of this translation carry most of the correctness weight:

**Anchors.** The synthetic origin point (always at 0,0) and any point the user explicitly fixed are emitted with `fixed: true`. Without at least one anchor, a sketch satisfying all its relative constraints can still drift as a rigid body — mathematically underdetermined even when it "feels" fully constrained.

**`arc_rules`, always.** Every arc receives an `arc_rules` primitive automatically. PlaneGCS does not enforce internal arc consistency on its own: without this rule, an arc's center, endpoints, radius, and angles are independent unknowns that drift apart during a solve, producing arcs whose endpoints no longer lie on the circle of the stated radius.

**Construction geometry is not special.** An earlier design pinned construction points and locked construction curve radii — "construction = locked scaffold." That was deliberately removed to match professional CAD semantics: construction geometry solves, drags, and dimensions exactly like solid geometry; the flag affects only rendering (dashed) and profile extraction (excluded). What remains is an *option*, `pinAllRadii`, which the drag path uses to lock every curve's radius at its current value during a translation drag so circles do not resize when the user means only to move them.

### The WASM lifecycle

The wrapper initializes lazily on the first solve (roughly 50 milliseconds) and is cached for the page lifetime. Each subsequent solve clears the solver's data, pushes the new primitive set, and runs — sub-millisecond for typical sketches, which is what makes drag feedback continuous. The WASM path resolution differs by runtime: the browser loads from an application asset path; the unit-test environment preloads the binary bytes and hands them to the loader directly, briefly masking the Node environment marker so the loader takes its web branch.

### Reading back, and refusing to corrupt

On success, results are copied home: new coordinates onto every point entity, new radii onto circles and arcs. Lines have nothing to read back — they are fully described by their endpoints. Synthetic primitives (external-reference geometry, arc rules, radius pins) are ignored during read-back; they exist only inside the solve.

On failure, nothing is applied. The solve function returns an `inconsistent` tag and the original, unmodified sketch state; the editor discards the constraint that triggered the failure and tells the user. Geometry never flinches. This strictness is a formal requirement: the user cannot corrupt a sketch by attempting an impossible rule.

---

## External References: Constraining Against the Model

A sketch rarely lives alone — it sits on a face of a solid, near edges the user wants to align with and dimension to. The constraint system reaches that 3D geometry through **external references**: constraints carrying an `externalRef` naming a model edge (or a curve's center), backed by a live 2D projection of that edge into the sketch plane supplied to every solve.

External references translate into *synthetic fixed geometry* rather than ordinary primitives — `translateConstraint` returns an empty array for them, and dedicated passes in the solve assembly build invisible anchors:

- **Riding an edge.** An on-edge constraint with an external reference produces two fixed points at the projected edge's endpoints plus a point-on-line primitive — so the sketch point *slides along* the edge (one degree of freedom) rather than being nailed to a spot on it.
- **Dimensioning to an edge.** A point-to-line distance whose line side is an external reference produces fixed endpoints, a synthetic fixed line through them, and a `p2l_distance` against that line. This is what lets Smart Dimension measure a sketch point directly against a model edge with no "convert entities" step, in either pick order, with a live preview — the SolidWorks three-click flow. If such a dimension would be redundant, it lands as driven.
- **Orienting to an edge.** Parallel and perpendicular against an external edge produce a synthetic fixed line and the corresponding orientation primitive.
- **Center references.** Concentric-to-a-model-circle and coincident-to-a-center are expressed as an external reference with `sub: 'center'`. These emit no primitive at all; a dedicated pass pins the constrained entity's center point at the projected center. Coradial-to-edge additionally pins the radius — and a plain on-edge circle pins its radius too, because the on-edge pass only pins the center, and a free radius would let later constraints silently resize the curve.

Because the projections are recomputed from the model's current geometry on every regeneration, external references *track*: move the solid's edge and the constrained sketch geometry follows on the next solve. The determinacy analyzer understands the same reference kinds, so a point dimensioned to an edge correctly reads as fully constrained rather than mysteriously free.

---

## The Solve Lifecycle

The sketch editor component — not the store — orchestrates when solves run.

**During a drag**, the solver runs on every frame: the dragged points are excluded from the movable set and pinned at the cursor, projected anchors are excluded, and `pinAllRadii` locks curve sizes. A monotonically increasing generation counter discards stale asynchronous results so a slow frame cannot overwrite a newer one. A failed frame simply does not emit — the geometry sticks at the last consistent frame, which doubles as tactile feedback that some constraint is resisting the drag.

**On commit** — adding a constraint, editing a dimension, toggling driven — the editor runs a plain, warm-started, full solve of the entire sketch, guarded by a commit-id check and a degeneracy check on the result.

The plain full solve is itself a lesson learned. An earlier design solved new constraints "local-first": a two-pass wrapper first restricted movement to only the points directly involved in the new constraint, retrying globally on failure, so that dimensioning one corner would not make the far side of the sketch jump. In practice the restricted pass could wander into degenerate collapses on under-determined sketches — the canonical failure was a rectangle flattening into a line when a dimension was added. The two-pass machinery still exists in the solver module but is deliberately not called; warm-starting the full solve from current geometry provides most of the locality the two-pass design was chasing, without the collapse mode. The dead code is kept as documentation of the road not taken.

---

## Diagnosis: Degrees of Freedom and Conflicts

Three independent mechanisms tell the user where their sketch stands.

### The scalar DoF count

PlaneGCS reports a single number after each solve: remaining degrees of freedom for the whole sketch. Zero means fully constrained. The editor surfaces this as the sketch's overall status — under-constrained, fully constrained, or over-constrained (the last when the solve is inconsistent) — mirrored in the 3D view as a color state.

### Per-entity determinacy

One scalar cannot color individual entities blue (locked) versus black (free). That analysis is computed independently, in `determinacy.ts`, by building the constraint system's Jacobian and analyzing its rank structure:

1. Enumerate free parameters: each non-fixed, non-origin point contributes x and y; each circle and arc contributes its radius.
2. Build the Jacobian by finite differences — perturb each parameter, measure each constraint's residual change. Each constraint type contributes one or two residual rows (a point-point coincidence is two rows; parallel is a cross product; perpendicular is a dot product; tangent picks the external or internal tangency by whichever matches current geometry).
3. Gauss-Jordan elimination with column pivoting identifies which parameters are **determined** — and the criterion is stricter than "has a pivot": a parameter counts as determined only if its pivot row is zero in every other free column, meaning its value is fixed *independently of every remaining free parameter*. A point held at "5 units from A" while A is free has a value, but not a value that won't change; it is correctly colored free.
4. Roll up from parameters to entities: a point is determined when both coordinates are; a line when both endpoints are; a circle when center and radius are; an arc when center, both endpoints, and radius all are.

External references participate: an edge-riding point is modeled as one degree of freedom along the projected line, and center-pinned references count as fully fixed. If the exact analysis throws on any degenerate input, a heuristic fallback (per-point DoF bookkeeping with constraint propagation) colors the sketch slightly conservatively instead of crashing the editor.

Finite differences here are a deliberate contrast with PlaneGCS's analytic Jacobians: determinacy runs once per settle, not hundreds of times per second, so simplicity wins over speed.

### Conflict identification

When a solve is inconsistent, "your constraints contradict" is not enough — the user needs to know *which ones*. On failure, the solver asks PlaneGCS for its conflicting primitive ids and maps them back to user constraints through the id conventions: exact matches, the `_prefix_` forms of synthetic solve geometry, and the `-suffix` forms of synthesized multi-primitive constraints. The editor then expands the conflicting constraint set to the entities they touch and paints *only those* red. A fully-dimensioned sketch with one contradictory dimension shows one red corner, not a sea of red.

PlaneGCS can also report *redundant* and *partially redundant* constraints; those APIs are exposed by the wrapper but not yet consumed — the one diagnosis SolidWorks offers that this system does not yet surface.

---

## The Creation Layer: Toolbar, Canonicalization, Inference

### Constraint specs

The toolbar is driven by a declarative table of constraint specs: each entry carries a type, label, icon, an enablement predicate over the current ordered selection, and optional value semantics. The predicates encode the geometric prerequisites — perpendicular, parallel, collinear, and angle need exactly two lines; symmetric needs two points and a line; concentric and coradial need two circles/arcs; tangent needs a line plus a curve or two curves; arc-length and chord-distance need exactly one arc. A button lights up only when the selection satisfies its predicate, which is most of the input validation the system needs.

Three specs are worth noting individually. **Equal X** and **Equal Y** are horizontal-distance and vertical-distance with an implicit value of zero — one-click alignment without a dialog. **Merge Points** looks like a coincident constraint but is an *action*: instead of persisting a constraint between two points, it collapses the two ids into one in the store, structurally welding the geometry. And the plain two-point **distance** was deliberately removed from the constraint toolbar — it lives exclusively in the Smart Dimension tool, matching where users actually look for it.

Before a constraint is committed, the selection is canonicalized: for the type-asymmetric constraints the point is sorted first regardless of click order, so the translation layer's assumptions always hold.

### Inference while drawing

Live inference runs on every mouse move during entity placement, checking in priority order: coincidence with an existing curve (with an extra snap to the curve's horizontal/vertical intersection point when close, stacking the axis constraint on top); tangency when drawing along a curve's tangent direction; horizontal within 5 degrees; vertical; polar tracking to 15-degree steps (guide only); alignment with existing points (guide only). The first four offers add real solver-backed constraints on click; the last two draw dashed guides and add nothing — the system never offers a constraint it cannot enforce. Inference is a pure function — cursor in, snapped position plus offers out — so it is directly unit-testable.

### Constraint visibility

Selecting an entity surfaces its geometric constraints as small icon badges floating next to it — one per constraint touching the entity directly or through a controlled point — and clicking a badge deletes that constraint. Dimensional constraints are excluded from the badges; they are full dimension annotations with their own rendering, leaders, and placement. Driven dimensions render muted with parenthesized values.

---

## Honest Limitations

- **Redundancy is not reported.** PlaneGCS's redundant-constraint report is available but unconsumed; a user who adds a harmless-but-redundant constraint gets no hint, where SolidWorks would flag it. (Redundant *dimensions* are handled — they drop in as driven.)
- **`sub` on targets is mostly inert.** The target type declares sub-element qualifiers, but translation dispatches on entity kind and uses arc/circle structure directly; the only live sub-element semantics is `externalRef.sub === 'center'`. The declared generality is ahead of its consumption.
- **Missing-target guards are silent.** Translation reads targets defensively and returns no primitives for a malformed constraint rather than throwing — a quiet no-op instead of a crash, which is the right failure direction but can mask a data bug.
- **Angle-to-model-edge does not exist.** Parallel, perpendicular, and distance support external edges; the angle dimension requires two actual sketch lines. Tangent-to-model-edge is likewise absent.
- **Diagonal on-edge lines are not fully enforced.** An on-edge line inherits horizontal/vertical enforcement only when the source edge is axis-aligned; a diagonal edge's orientation is not yet held by a phantom collinear reference.
- **One dimension-entry path still uses the browser's native prompt dialog** — functionally correct, aesthetically out of place.
- **The server never re-runs the solver.** Regeneration trusts the client's solved coordinates. Correct today because the client always solves before saving; documented as the gap it is.

---

## Key Points

- A constraint is a typed record with ordered targets; `translateConstraint` maps each to zero, one, or several PlaneGCS primitives across four categories: direct (perpendicular → `perpendicular_ll`), kind-dispatched (tangent has six variants, equal four, coincident five), synthesized (midpoint = point-on-line + point-on-perpendicular-bisector; symmetric, coradial, collinear similarly compose two primitives with suffixed ids), and the subtle dimensional cases (signed four-point angles with persisted quadrant rays, coordinate-difference dimensions, chord distance reusing arc endpoints).
- Driven dimensions translate to nothing — reference annotations that make over-annotation structurally safe.
- PlaneGCS (FreeCAD's solver, WASM build, DogLeg algorithm) is vendored with provenance; every arc gets an automatic `arc_rules` primitive; the origin and explicitly-fixed points are the anchors that stop rigid-body drift.
- Construction geometry is no longer pinned — the earlier "locked scaffold" semantics were removed to match professional CAD; only the drag path's `pinAllRadii` option locks radii, and only during drags.
- External references translate into synthetic fixed geometry built from live edge projections: ride-the-edge (slide, one DoF), dimension-to-edge (no convert-entities step), orient-to-edge, and center pinning via `sub: 'center'`. Projections re-derive every regeneration, so references track the model.
- Commits run a plain warm-started full solve; the local-first two-pass design was abandoned after it collapsed under-determined sketches, and its code remains, deliberately uncalled.
- Failure never mutates: inconsistent solves return the original state, and PlaneGCS's conflicting-primitive report is mapped back through the synthetic-id conventions so only the actually-conflicting entities paint red.
- Per-entity blue/black coloring comes from an independent finite-difference Jacobian analysis with a strict determinacy criterion — a parameter is locked only if its value is independent of every remaining free parameter — with a conservative heuristic fallback that never crashes.
- The toolbar is a declarative spec table (predicate-gated buttons, implicit-zero alignment dims, a merge-points action); inference offers only enforceable constraints (coincident, tangent, horizontal, vertical) and draws guides for the rest.
- The notable gaps: redundancy reporting exists in the solver but is unconsumed, angle/tangent-to-model-edge are missing, and the server trusts client-solved coordinates without re-solving.
