# Sketching and the 2D Constraint Solver

This document covers the 2D sketching layer of the CAD module: what a sketch is as data, how the vendored PlaneGCS Newton-Raphson solver turns geometric rules into a consistent shape, how the editor determines whether a sketch is fully constrained, why rendering and solving and picking use three separate representations of the same curve, and how the system extracts a closed profile from a sketch and hands it to the 3D kernel for extrusion.

---

## The Sketch Data Model: One List, Tagged Unions

### From many arrays to one list

An early design stored separate arrays for points, lines, circles, and constraints. Adding each new curve kind — arc, ellipse, spline — required updating every consumer of the sketch: the renderer, the picker, the saver, the profile extractor. The complexity multiplied as kinds times consumers.

The current design collapses all geometry into **one `entities` list**. Every entry is a tagged union (also called a discriminated union): a record with a `kind` string that tells code how to read the rest of the object. Thirteen kinds are defined in `types.ts`, the central type dictionary for the CAD module.

### Entity kinds and their structure

Every entity shares a base: an `id` string and an optional `construction` boolean. The kind-specific fields are:

- **point** — `x`, `y` coordinates
- **line** — `startId`, `endId` (references to point entities; a line carries no coordinates itself)
- **circle** — `centerId` (point reference), `radius`
- **arc** — `centerId`, `startId`, `endId`, `radius`, `ccw` (counterclockwise sweep direction)
- **ellipse** — center point, major-axis endpoint, minor radius
- **spline** — list of control point IDs, `degree`
- **conic** — parabola or hyperbola defined by a set of point references
- **text** — four corner points forming a dimensionable bounding box
- **picture** — imported raster image you can trace over
- **equationCurve** — x and y as explicit functions of a parameter t

Two more exotic kinds (intersection curve, spline-on-surface) exist for 3D-adjacent scenarios. Because every new kind is an extension to the union rather than a new parallel array, downstream code only needs to handle the kinds it cares about; the rest fall through cleanly.

### Lines reference their endpoints by ID — and that's load-bearing

A line stores the IDs of its two endpoint point-entities, not literal coordinates. When two lines share a corner, they share a single point entity. Dragging that point moves both lines automatically; no scan for "nearby coordinates" is needed. The connectivity is structural.

### The construction flag

`construction: true` marks an entity as reference geometry: it participates in the constraint solve but is excluded from profile extraction and does not become material in 3D. A construction centerline can be the axis of a symmetric constraint. The system keeps the flag consistent: toggling a curve to construction also flags its support points, so a dashed construction circle has a dashed center dot — visual coherence and semantic consistency together.

The flag's meaning grew organically from "don't extrude this" to "locked reference scaffold" — a construction circle is a stable thing to build tangencies and symmetry against. The cascade logic lives in `store.ts`, in `setConstructionFlag`.

### The forced origin point

Every sketch is seeded with a synthetic origin point whose ID is the string `"origin"`, positioned at (0, 0), marked construction, and non-deletable. Old sketches that predate this rule have it backfilled by `ensureOriginPoint`. Without a real, addressable origin entity, there would be no stable thing to attach "pin this corner to the origin" constraints to.

### In-memory migration from the old schema

Before the tagged-union redesign, sketches were stored as a `points` array, a `lines` array, and a `constraints` array. Rather than a bulk database migration — risky, touching the version-control layer — the system migrates lazily. On load, `isLegacySketchState` in `migration.ts` detects the old shape. If found, `migrateSketchState` converts it in memory: arrays become tagged entities, the origin is backfilled, old constraint types (`point-on-line`, `point-on-curve`) map to `coincident`, and the old `projectedFrom` field becomes `on-edge`. The document saves back in the new format on the next edit. The user never knows this happened.

---

## The Constraint Solver: Vendored PlaneGCS

### Why Newton-Raphson, not iterative nudging

The original solver used iterative projection: nudge each shape toward satisfying each constraint, loop until converged. For simple sketches — a rectangle with four distance constraints — this works. For mixed systems with tangencies, perpendicularity, equal-radius, and dimensional constraints all interacting, iterative projection has no convergence guarantee. It can oscillate, creep to a wrong local answer, or stall.

Newton-Raphson treats the problem correctly. Every constraint is an equation that should equal zero. "Distance minus 20 = 0." "Slope of line A minus slope of line B = 0" (parallel). Stack all constraints into a system of equations whose unknowns are all the coordinates and radii in the sketch. Solving the sketch is solving "where do all these equations equal zero simultaneously."

Newton-Raphson starts at the current geometry as a guess, computes the Jacobian — "how does every constraint's error respond to a small change in every unknown" — and takes a step downhill, roughly doubling precision per iteration. The key quality distinction is **analytic Jacobians**: computing derivatives from closed-form expressions rather than by finite-difference nudging. Analytic derivatives are exact, cheap, and numerically stable.

### PlaneGCS: what it is and why it is vendored

**PlaneGCS** (planar geometric constraint solver) is the 2D sketch solver that ships inside FreeCAD. It implements Newton-Raphson with analytic Jacobians, hardened over years of real-world use across the full range of geometric constraint types. REQ 558 pins this choice.

PlaneGCS is written in C++ and compiled to **WebAssembly**, so the numeric solving runs in the browser at near-native speed with no server round-trip.

The solver is **vendored**: the WASM binary and wrapper live at `frontend/src/app/cad/vendor/planegcs/`, not fetched from npm. Vendoring insulates the sketcher from upstream disappearance or unpublishing by the single upstream maintainer. A `PROVENANCE.md` there records the source and the update procedure. The LGPL-2.0-or-later license is honored by keeping the WASM binary as a swappable file — users can drop in their own `planegcs.wasm`.

### Building the primitive set: `buildPrimitives` and `translateConstraint`

Before calling the solver, the sketch must be translated into PlaneGCS's own vocabulary. The entry point is `solveSketch`, which calls two functions.

**`buildPrimitives`** maps entities to PlaneGCS counterparts: points, lines, circles, and arcs translate directly. Fixed points — the origin and any explicitly fixed user point — are emitted as immovable anchors. Without at least one anchor the sketch can drift as a rigid body, satisfying relative constraints while floating in space.

Every arc also receives an **`arc_rules` primitive** — automatically, with no exceptions. PlaneGCS does not enforce arc geometry consistency on its own. Without arc_rules, the arc's center, start-point, end-point, radius, and sweep angles are each treated as independent unknowns and can drift independently during the solve, producing arcs whose start point no longer lies on the circle of the stated radius. The arc_rules constraint enforces that start and end are on the circle and that radius and angles agree. The ID follows the pattern `arcrules-<arcId>`.

**`translateConstraint`** converts each user constraint into one or more PlaneGCS primitives. There are three translation categories:

**Direct, one-to-one**: horizontal → `horizontal_l`, vertical → `vertical_l`, distance → `p2p_distance`, perpendicular → `perpendicular_ll`, parallel → `parallel`. Clean handoffs.

**Dispatch-by-kind**: the same user constraint emits different PlaneGCS primitives depending on the entity types selected. Tangent between a line and a circle is a different equation than between two circles or a circle and an arc; a helper `tangentPrimitive` picks among six variants. Equal behaves similarly: equal length of two lines, equal radius of two circles, and two arc variants are four distinct PlaneGCS primitives. The user sees one "tangent" button; the solver sees the geometrically correct equation.

**Synthesized, one-to-many**: some high-level constraints have no single PlaneGCS primitive and are composed from two. Midpoint — "this point is the midpoint of this line" — becomes (1) a point-on-line constraint and (2) a point-on-perpendicular-bisector constraint; both together nail the point to the exact center. Symmetric = midpoint-on-axis + perpendicular to axis. Concentric = coincidence of the two center points. Coradial = concentric + equal-radius. Collinear = parallel + point-on-line.

Synthesized primitives need IDs that cannot collide with any entity ID. The convention is to suffix the parent constraint's ID: `c42-onl`, `c42-pb`. Getting this wrong produces intermittent, maddening solve corruptions.

**Dimensional constraints** emit their matching PlaneGCS dimensional primitive: `circle_radius`, `arc_radius`, diameter variants. Angle constraints use an angle-between-four-points primitive with a sign chosen from the current geometry so the solver rotates the short way to the target — not 350 degrees the long way. Horizontal-distance and vertical-distance use a "difference" primitive on the x or y component alone.

### Solving, reading back, and handling failure

Primitives are handed to the WASM wrapper via `push_primitives_and_params`. The internal algorithm is DogLeg — a robust Newton-Raphson variant blending the aggressive Newton step with a safer gradient step. The WASM module initializes lazily on the first solve (approximately 50 ms), then is cached for the page lifetime. Subsequent solves call `clear_data`, push the new problem, and run; sub-millisecond per solve is what makes dragging feel continuous.

If the status is Success or Converged, `apply_solution` runs and `readBack` copies results home: new x and y onto every point entity, new radius onto every circle and arc. Lines have no coordinates to read back — they are fully described by their endpoint points.

**Failure is handled strictly** (REQ 526). If the solver returns anything other than Success or Converged — meaning the constraints are contradictory or the system cannot converge — no results are applied. The function returns an `inconsistent` result tag and the **original, unmodified sketch state**. The editor discards the new constraint and informs the user (REQ 532). Geometry never flinches; the user cannot corrupt their sketch by trying an impossible rule.

### Local-first solving and drag stability

When adding a constraint, many valid solutions often exist. The wrapper `solveSketchAfterAdd` does two passes: first with `movablePoints` restricted to only the points directly involved in the new constraint; if that fails, it retries globally. The effect: a dimension added to one corner adjusts that corner only; the far side of the sketch does not jump. The `pinAllRadii` option locks radii during drags so circles do not resize when the user intends only to translate.

---

## Determinacy: Knowing When a Sketch is Fully Constrained

### What the solver's DOF count doesn't tell you

PlaneGCS returns a degree-of-freedom count for the whole sketch — one scalar. "This sketch has 3 DOF remaining." It does not identify *which* parameters are free. The editor needs per-entity information to color shapes: blue for fully determined (cannot move), black for still free (REQ 533).

That per-entity analysis lives in `determinacy.ts`, in `analyzeDeterminacy`.

### Jacobian-rank analysis

Step 1: enumerate every free parameter. Each non-fixed point contributes x and y; each circle and arc contributes its radius. Fixed points and the origin are excluded.

Step 2: build the constraint Jacobian by finite differences — nudge each parameter by a step around 10^-7, measure each constraint's residual change. Rows are constraints, columns are parameters. Finite differences are used here (not analytic derivatives) because this runs once per settle, not hundreds of times per second. Simplicity and correctness outweigh speed for a once-per-settle classification.

Step 3: Gauss-Jordan elimination to reduced row echelon form exposes pivot columns. A parameter is *determined* only if its pivot row has zeros in every other free column — its value is fixed regardless of any still-free variable. A parameter pinned only in terms of another free parameter is not truly locked: if A is free and B is "5 from A," B moves when A moves. This "has a value that won't change" distinction (not just "has a value") is what makes coloring match professional CAD behavior.

Step 4: `rollUpToEntities` translates from raw parameters to shapes. A point is determined when both x and y are; a line when both endpoints are; a circle when center and radius are; an arc when center, start, end, and radius all are. Arc internal invariants (start and end lie on the circle) are folded into the Jacobian as implicit rows.

The returned value is the set of entity IDs that are fully determined. The viewer asks, for each entity: "are you in this set?" Blue if yes, black if no.

### Heuristic fallback: `analyzeHeuristic`

If the exact Jacobian analysis throws for any reason — a degenerate sketch, a numerical edge case, malformed state — the editor falls back to `analyzeHeuristic`. This simpler approach tracks per-point degree-of-freedom counts (2 for free, 0 for fixed) and propagates reductions through easy constraints. It is less accurate — it misses some implicitly determined triangles — but it never crashes. The coloring becomes slightly more conservative for that one sketch instead of breaking the editor. The fallback is deliberate, documented, and considered acceptable.

---

## The Three-Way Split: Render, Solve, Pick

A single circle on a sketch is represented three different ways by three different subsystems. This is intentional.

### Rendering: tessellation

The 3D overlay draws line segments, not mathematical curves. Every circle and arc is **tessellated** — approximated by a fan of short straight chords — by `tessellator.ts`. The number of segments is determined by chord tolerance: the maximum allowed gap between the true curve and the chord crossing it. Default tolerance is 0.05 units. The formula is the ceiling of π over arccos(1 − tolerance/radius): larger circles and tighter tolerances produce more segments; small circles need only a few. A floor of 3 segments is enforced. Arcs are tessellated proportional to their sweep angle.

Tessellation serves two consumers: the renderer (visual display) and the pure-JS extrude path. The extrude kernel operates on straight-edged polygons, so curves must become polylines before they can be extruded in that mode. This is codified by REQ 562.

### Solving: parametric form

The solver works on the **analytic, parametric** definition — a circle is a center point and a radius, two numbers. PlaneGCS reasons about the true mathematical circle when resolving tangency or radius constraints. If it solved against tessellated facets, every constraint answer would be slightly wrong (tangent to a facet, not to the curve), and the error would vary with tessellation density. The solver never sees a chord.

### Picking: analytic distance

When the user clicks, hit-testing uses the **analytic definition** again — but for a different reason than the solver. The distance from a cursor position to a circle is: |distance(cursor, center) − radius|. The ring distance. It has nothing to do with facets.

Testing against tessellation produces dead zones: between two adjacent chords, the true curve bulges outward by up to the chord tolerance, and a click in that gap "falls through" and misses. This degradation worsens as tessellation becomes coarser. REQ 564 specifies explicitly that pick accuracy must be independent of the tessellation used for rendering.

`picking.ts` implements `distanceToEntity` analytically for every common kind. A line is the perpendicular distance to the segment, clamped to its endpoints. An arc is the ring distance if the cursor angle falls within the arc's sweep; otherwise it is the distance to the nearer endpoint. Ellipses and splines fall back to tessellation-based distance because true closest-point on an ellipse requires iterative root-finding and the hit-tolerance is generous enough that the approximation is acceptable. Points, lines, circles, and arcs — the everyday shapes — are fully analytic.

### Priority when multiple shapes are near the cursor

PICK_RANK resolves ambiguity in two passes. First: if any point entity is within a small point-tolerance, it wins outright — near a junction the vertex is almost always the intent. Second: a rank map (points rank 0, curves rank 1, text rank 2, pictures rank 3) prioritizes small, precise, structural shapes over large area-filling ones. A traced image does not absorb clicks meant for construction lines underneath.

---

## Profile Extraction: From Sketch to Closed Loop

### The problem

A sketch is a bag of entities. Some are construction and excluded. The rest form geometry that may include intersecting curves, shared corners described by constraints (not shared IDs), and nested closed loops. The 3D kernel needs a clean answer: what are the closed, oriented loops, which ones are holes inside others, and which are separate regions?

The pipeline runs in two places: `profile.ts` in the browser (live "can I extrude?" affordance and region previews) and `cadProfile.js` on the server (regeneration). They are kept in lockstep; the test suite asserts matching output. One documented limitation: the server does not re-run PlaneGCS — it trusts the client's already-solved coordinates and re-extracts the profile from those.

### Step 1: Canonicalize points — `canonicalizePoints` in `cadProfile.js`

When a user draws a rectangle, each line is created with fresh endpoint IDs. Where two lines meet, the editor does not reuse one ID; it creates a new point and links them with a coincident constraint. A four-corner rectangle has eight point entities.

Walking the graph by shared ID would find eight dead-ends, never a closed loop. `canonicalizePoints` runs a union-find: it merges point IDs that are either joined by a coincident constraint or within a tiny spatial tolerance of each other. After the merge, the eight points collapse to four canonical corners. Without this step, essentially no hand-drawn shape would extrude successfully.

### Step 2: Split at intersections — `splitAtIntersections` in `arrangement.ts`

Two curves may cross geometrically without sharing a user-placed point at the crossing. A line slashing through a circle produces two half-disk regions, but there is no intersection point in the data. `splitAtIntersections` computes every pairwise geometric crossing among non-construction curves and inserts new points there, splitting each curve at the crossing. The line becomes three sub-segments; the circle becomes two arcs. Duplicate crossings within a spatial epsilon are collapsed via a bucket map. After this step, every crossing is a real shared vertex.

### Step 3: DCEL walk — `arrangement.ts`

The edges of the sketch (after steps 1 and 2) are built into a **doubly-connected edge list (DCEL)**. Each edge becomes two directed half-edges, one each way. Each half-edge records its start point, end point, twin, and **exit angle** — the tangent direction leaving its start vertex. For a line this is its slope; for an arc it is the arc's tangent at that endpoint, which depends on curvature and direction.

Faces are enumerated by the "always turn the same way" rule. At each vertex, outgoing half-edges are sorted by angle. When arriving along a half-edge, the next half-edge around the face is the one immediately clockwise from the twin in that sorted fan. Following next-pointers from any half-edge traces exactly one closed face. Collecting all faces from unused half-edges enumerates every face.

Bounded faces are distinguished from the unbounded outer face by signed area (the shoelace formula). Positive signed area means a bounded interior region. Negative or zero is the infinite exterior and is discarded.

### Step 4: Nesting — `extractRegions`

The bounded faces are tested for containment. The system tessellates each loop coarsely (just enough for point-in-polygon testing) and builds a containment matrix. Each loop finds its **direct parent** — the deepest, tightest loop that fully contains it — and becomes a hole in that parent. A washer — two concentric circles — yields an annulus region (outer boundary, inner hole) and separately an inner disk region. Both exist. The user selects which regions to extrude via a `regionIndices` field on the Extrude feature. Default is region 0.

### Typed loop edges preserve curve identity

Each edge in a profile loop carries its true type — line, arc, circle, Bézier — with its analytic definition, not a pre-baked polyline. Handing the kernel a typed arc edge lets it build one smooth curved face. Handing it a tessellated arc — forty segments — produces forty flat side faces. REQ 617 requires that an extruded arc produce a single curved side face. Typed loops also keep face naming stable downstream.

### The single-circle shortcut

If the sketch contains exactly one non-construction circle and no non-construction lines or arcs, `extractClosedLoop` short-circuits. One circle in, one self-closing circle edge out. No graph machinery for the most common simple profile.

---

## Inference: Constraint Suggestions While Drawing

`inference.ts` provides live constraint suggestions during entity placement. `inferLineEnd` runs on every mouse-move while the user draws a line, checking in priority order: (1) curve coincidence — snap to an existing curve, offer `coincident`; (2) horizontal snap within 5 degrees, offer `horizontal`; (3) vertical snap; (4) polar tracking to 15-degree multiples — snap and draw a dashed guide, no constraint; (5) alignment with other sketch points — snap and draw a guide, no constraint.

First match wins. Coincidence, horizontal, and vertical add real solver-backed constraints. Polar and alignment add only visual guidance — the system never offers a constraint it cannot enforce. Inference is pure: cursor in, snapped-position-plus-offer out; nothing is committed until the user clicks.

---

## Edit Operations: Trim, Extend, Mirror, Offset

`sketchEditOps.ts` provides sketch editing tools. Every function is pure: sketch in, new sketch out, no mutation.

**Trim** (`trimAt`): finds all points where other curves cross the target curve, identifies the two crossings bracketing the click location, and replaces the original curve with the sub-segments to keep. Direction-type constraints — horizontal, vertical, parallel, perpendicular, collinear, on-edge — inherit onto every surviving sub-segment, because a piece of a horizontal line is still horizontal. Length and equal constraints do not inherit, because the sub-segment has a different length than the original. Before creating a new endpoint at a crossing, the function checks for an existing point within a thousandth of a unit and reuses it.

**Mirror**: reflects selected entities across a centerline. `reflectAcrossLine` handles geometry per kind. After reflecting, it emits `symmetric` constraints linking each original point to its mirror and `equal` constraints linking each original curve to its copy. The mirror stays live: editing the original moves the copy automatically via the solver.

**Offset**: generates a parallel curve at a distance. For a line, a perpendicular translation; for a circle, a radius change by whether the click was inside or outside. For chained offset across a connected run, a flood-fill finds all connected curves by shared coordinates. A polygon-containment test (closed loops) or handedness propagation (open chains) establishes which side is inward, and all segments offset consistently from one seed click.

---

## Honest Notes: What Is Unfinished or Approximate

### The toolbar is ahead of the implementations

The sketch editor's toolbar enumerates the full SolidWorks-equivalent set of tools: point, line, centerline, midpoint-line; circle variants, arc variants, ellipse, partial ellipse, parabola, equation curve; four rectangle variants, parallelogram, polygon, four slot kinds, text, picture; trim, extend, fillet, chamfer, split, jog. Many of these buttons render in the toolbar. The data model genuinely supports all thirteen entity kinds — the tagged union, the store, the solver mappings are complete. But the interactive authoring tool that lets you *draw* a given kind is not always wired through.

Currently solid and fully functional end-to-end (draw → constrain → solve → extract → extrude): points, lines, circles by center-and-radius, arcs by center-and-endpoints, rectangles, polygons. The exotic kinds — splines, conics, equation curves, text, pictures — exist in the model and tessellate and pick, but their authoring tools and some downstream handling are at varying stages.

### `window.prompt` for dimension entry

When adding a dimensional constraint such as "make this radius 25," at least one code path uses the browser's native `window.prompt` dialog — the plain gray "this page says..." box. It is functionally correct: type the value, press enter, the constraint gets the number, the solver runs, the geometry snaps. Pressing Escape or Cancel aborts cleanly. It is aesthetically inconsistent with the otherwise polished 3D editor. The intended replacement is a Material dialog component. The footgun is documented; it was not blocking enough to fix immediately.

### Determinacy coloring is an approximation under failure

The exact Jacobian-rank analysis is accurate. When it falls back to `analyzeHeuristic`, the result is slightly too conservative — some implicitly-determined configurations are colored black (free) when they are in fact fully locked. This is documented and deliberate: a slightly cautious coloring is better than a crashed editor.

### Server-side solving is not implemented

The backend regeneration service (`cadRegenService`) re-extracts profiles from stored sketch documents but does not re-run PlaneGCS. It trusts the client-solved coordinates. This is correct today because the client always solves before saving, making the stored coordinates valid. It is a documented limitation, not an oversight: if the client ever saved without a successful solve, the server would propagate whatever geometry was stored. Server-side solving is noted as future work.

---

## Key Points

- Sketch entities are stored as a single tagged-union list in one `entities` array, with each entity carrying a `kind` field; this eliminates per-consumer loops over multiple arrays and makes adding a new entity kind an extension rather than a change to every consumer.
- The `construction` flag marks reference geometry that participates in solving but is excluded from extrusion; its meaning grew organically from "don't extrude" to "locked reference scaffold," and it cascades to an entity's support points for visual and semantic consistency.
- PlaneGCS — FreeCAD's 2D constraint solver — is vendored at `frontend/src/app/cad/vendor/planegcs/` and compiled to WebAssembly; it is deliberately not managed via npm to insulate against upstream disappearance or version drift.
- `translateConstraint` returns an array: some user constraints map one-to-one to PlaneGCS primitives, some dispatch by entity kind (tangent has six variants), and some are synthesized from two primitives (midpoint = point-on-line + point-on-bisector); synthesized primitives use suffixed IDs to avoid collisions.
- Every arc must have an `arc_rules` primitive emitted by `buildPrimitives`; without it, PlaneGCS allows the center, endpoints, radius, and angles to drift independently, producing geometrically inconsistent arcs.
- Contradictory constraints never corrupt the sketch: if solve fails, the original state is returned unchanged and the new constraint is discarded (REQ 526/532).
- Per-entity determinacy (the blue/black coloring) is computed in `determinacy.ts` by Gauss-Jordan elimination on a finite-difference Jacobian; a parameter is "determined" only if its value is fixed independently of all remaining free parameters — not merely if it has a constraint relating it to something else.
- A circle is represented three ways: a fan of chord segments for the renderer and extruder (tessellator.ts), a center-and-radius for the solver (PlaneGCS), and an analytic ring distance for pick hit-testing (picking.ts); this decoupling means coarse rendering never degrades pick accuracy.
- Profile extraction from a sketch requires canonicalizing coincident-constrained points (union-find), splitting curves at geometric crossings (DCEL arrangement), walking faces with half-edge sorted-angle next-pointers, and nesting loops by containment to distinguish outer boundaries from holes.
- Several toolbar buttons — three-point arc, tangent arc, slot variants, and others — render in the UI but their interactive authoring implementations are partial; dimension entry in at least one path uses `window.prompt`; the server does not re-run the constraint solver during regeneration. All three are documented limitations.
