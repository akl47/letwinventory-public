# Features: From 2D Sketches to 3D Solids

This document covers how the parametric CAD system turns flat 2D sketches into 3D solid parts: the feature tree that stores the build recipe, the regeneration pipeline that replays it, additive and finishing features, datum construction, the Hole Wizard, equations, and multi-body modeling — including the honest limits of each mechanism.

## The Feature Tree: a Recipe, Not a Shape

A finished part looks like a solid chunk of metal, but the system never stores the shape directly. It stores the ordered list of steps that produce the shape when followed in sequence. That list is the **feature tree**, implemented in `featureTree.ts`.

The data structure is deliberately simple: an object with a `features` array and a counter. Each element of the array is one build step — a **feature** — tagged with a `type` field (`extrude`, `fillet`, `hole`, `revolve`, and about twenty others), a unique id, a creation timestamp, and a bag of parameters appropriate to that type. Because it is a tagged union, type-guard helpers like `isExtrudeFeature`, `isOriginFeature`, and `isAnyExtrudeFeature` narrow the type safely before any code reaches for type-specific fields.

### Order is Time, Not Z-Stacking

The order of features in the array is causal, not cosmetic. An extrude can only happen after the sketch it consumes. A fillet can only round edges that exist, so it must follow the extrude that made them. This is a timeline of construction history. Editing the model means editing a step in the past and replaying forward — that is the fundamental operation. Changing the base plate thickness ripples through everything built on top of it because downstream features literally re-execute against the new result.

### The Origin Feature

Every fresh model is initialized with exactly one feature: the Origin. The function `emptyFeatureTree` seeds the tree with it. The Origin carries the standard reference scaffolding — three reference planes (front, top, right), three axes, and a center point. Every subsequent sketch needs a plane to draw on; the Origin provides three before you have drawn anything. The Origin makes no geometry of its own; it is pure reference and is the only feature with that property.

### Immutable Operations

Every operation on the feature tree produces a new copy rather than mutating the existing array. `addFeature` appends and returns a new tree; `removeFeature` filters and returns a new tree; `updateFeatureParam` merges a patch into one feature and returns a new tree. This immutability is not ceremony — it has two practical consequences. First, undo is trivial because the old reference still exists. Second, Angular's change-detection is reference-based; mutating in place would leave the screen stale even when the data changed.

`addFeature` also auto-names new features SolidWorks-style: counting how many of that kind already exist and labeling accordingly ("Extrude 1," "Extrude 2," "Cut-Extrude 1," "Fillet 1"). An optional `name` field on every feature lets designers rename to something meaningful ("Mounting Boss," "Lightening Pocket"); when set, the friendly name takes over in the tree panel.

### Feature IDs

Feature ids are globally unique random strings from `ids.ts`. The tree retains a legacy `nextFeatureSeq` counter from an earlier sequential scheme — sequential ids collide across history branches (two branches both mint "f4") — so live generation is now random. The counter is vestigial.

### Cascading Deletion

`removeFeaturesReferencingSketch` handles sketch deletion when downstream features depend on it. It walks the tree and drops every feature whose `sketchId`, `profileSketchId`, or `pathSketchId` matches. The UI alternative is to break references instead — leaving the downstream features with an invalid sketch id that `regenerateModel` reports as errors — without requiring a dedicated "broken" feature state.

## The Regeneration Pipeline

The heart of the system is `cadRegenService.js` on the backend, specifically the `regenerateModel` function. It is called on every save or edit, and by the exporters when a user downloads a STEP or STL file. Its job: take the stored feature tree plus the sketch document and produce displayable 3D geometry. It does this in a fixed sequence.

### Step 0: Resolve Equations

Before touching any feature, `regenerateModel` resolves all equation formulas to plain numbers and bakes the results into the tree. The kernel never sees a formula. By the time dispatch begins, every drivable parameter — extrude distances, constraint values, anything an equation targets — is a concrete number.

### Step 1: Walk Features in Order

The pipeline iterates front to back. Each feature is skipped if: it is the Origin (no geometry); it has `suppressed` set; it has `visible === false`; or it is at or past the **rollback bar** — a movable line in the tree that temporarily excludes features below it, enabling mid-history insertion.

Skipping is not "produce empty geometry" — it is "pretend this step never ran." Downstream features compose against whatever existed before the skipped feature. Suppress the middle extrude and the fillet after it has no new edges to round; it operates on the earlier body. Suppression can cascade errors downstream.

### Step 2: Dispatch by Family

Surviving features dispatch into three families:

**Datums** (datum plane, datum axis, datum point) are folded into the running datum list with no kernel call. They are pure reference geometry, rebuilt against current geometry on every regen.

**Modifier features** (fillet, chamfer, shell, combine, hole, patterns, mirror-body, move-copy-body) take an existing body and transform it. Each routes to its own dispatch helper.

**Prism builders** (extrude, cut-extrude, revolve, cut-revolve, sweep, cut-sweep, loft) are the 2D-to-3D family. They run a two-stage flow: first build the prism from the sketch; second compose it into the running bodies. The split exists because building is expensive and cacheable; composition is cheap but depends on everything before it.

## Profile Extraction and the Geometry Cache

### Extracting a Profile

Before the kernel can extrude a sketch, the profile must be extracted from it. That work lives in `cadProfile.js` on the backend (mirroring the frontend module `profile.ts`), in a function called `extractRegions`.

A "profile" is the closed outline to be pushed into 3D. Extracting it is less trivial than it sounds. First, `canonicalizePoints` unifies points that are joined by a coincident constraint or sit within 10⁻⁴ units of each other — a four-line rectangle otherwise has eight loose endpoints instead of four shared corners. Once corners are unified, the walker forms closed loops.

Second, the extractor handles nesting. A circle drawn inside a square forms two closed loops, but they are not independent: the circle is a hole in the square. Point-in-polygon testing determines which loops are inside which, and the result is a set of `ProfileRegion` records — each an outer boundary plus a list of holes. Extruding a region with a hole produces a tube rather than a solid block, because the kernel subtracts the inner boundary automatically.

Third, profile extraction preserves curve identity. Each edge in a loop stays typed — a line is a line, an arc is an analytic arc with center and radius, a circle is a circle. The kernel builds one smooth analytic face per typed edge. An extruded rectangle yields exactly six faces. Tessellating arcs into chord segments before extrusion would produce dozens of tiny flat faces where one curved face should be, breaking downstream operations like fillet and measurement.

Two disjoint regions in one sketch — a circle and a triangle that do not touch — become two separate regions and fan out into two separate bodies.

### The BRep Cache

Calling the kernel is expensive: it is a separate Rust process running OpenCascade, reached over a remote-procedure-call channel. Before every kernel call, the pipeline checks a content-addressed cache. The database model is `DesignBRepCache` (BRep = boundary representation, the precise mathematical solid the kernel produces).

The cache key is a tuple: model id, feature id, `paramHash`, `upstreamHash`, and `namingVersion`. The `paramHash` is a SHA-256 truncated to 32 hex characters, computed over the feature's fully resolved inputs — the profile, holes, sketch plane, distance, flip flag, end conditions, and any secondary direction. Same inputs → same hash. Different distance → different hash.

On a rebuild, the pipeline computes the current `paramHash` for each feature and queries the cache. A hit means the geometry is pulled directly — zero kernel calls, just a timestamp bump. A miss means calling the kernel, getting the geometry, and filing it under the new key.

This is the mechanism behind efficient rebuilds. Changing the base plate thickness changes only that feature's `paramHash`. Features downstream — cooling slots, holes, fillets — have their own parameters unchanged, so their `paramHash` values are identical and they hit the cache. The two-stage split makes this work: the *prism* (what shape is the slot?) is cached and unchanged; the *composition* (stamp this slot into the current metal) reruns cheaply against the new body every time.

A formal requirement in the spec states this property explicitly: editing a global equation that drives one of ten extrudes must cause exactly one cache miss in the logs, not ten. There is a test that mutates an unused global and asserts an unrelated feature's `paramHash` is byte-for-byte the same.

### The namingVersion

The cache key includes a `namingVersion` integer (currently 20). The kernel returns not just a shape but names for its faces and edges, so the rest of the system can refer to "that face" stably. When the kernel's naming scheme or mesh format changes, old cached rows describe geometry in the old scheme. Reusing them produces maddening mismatches. `NAMING_VERSION` is a single shared constant, identical in the backend code and in the kernel; bumping it instantly invalidates all old rows, forcing a clean rebuild. Forgetting to bump it when kernel output changes is a known path to shipping corruption.

### Cache Eviction

An eviction service runs hourly and deletes rows untouched for 14 days. Every hit bumps the "last accessed" timestamp, so actively used geometry never goes cold. The entire table is derived — drop it and nothing is lost; the feature tree is the truth and the cache rebuilds itself on next access.

## Additive Features: Extrude, Revolve, Sweep, Loft

### Extrude

Extrude pushes a closed profile straight out, perpendicular to its sketch plane. The feature carries a `sketchId`, a `distance`, and several refinements. A `flipped` flag reverses the growth direction to the other side of the sketch plane. An `endCondition` field selects among: `blind` (exact distance), `midPlane` (symmetric growth both ways), `throughAll` (pierce everything in the way), `upToVertex`, `upToSurface`, `offsetFromSurface`, and `upToBody`. The smart end conditions express design intent — "this boss reaches the top face" — rather than a hard number, so they follow that face if it moves. A `direction2` field enables asymmetric two-direction growth; `regionIndices` selects which loops in a multi-loop sketch to extrude; a `merge` flag controls whether the result fuses into the existing body or seeds a new one.

### Revolve

Revolve spins a profile around an axis line — like a lathe — producing any rotationally symmetric shape. The feature carries an `axisLineId` referencing a line drawn in the same sketch, whose endpoints define the spin axis, plus an `angle` (360° for a full solid of revolution, less for a partial arc sweep).

### Sweep

Sweep drags a cross-section along a path, producing pipes, handrails, and similar constant-section forms. It requires two sketch references: `profileSketchId` (the cross-section) and `pathSketchId` (the route).

### Loft

Loft blends between two or more different cross-section outlines. It carries an ordered list of sketch ids and interpolates through them, enabling transitions from square to circle, or fan-blade profiles.

### Cut Variants

Every additive feature has a cut counterpart (cut-extrude, cut-revolve, cut-sweep). The geometry is identical; the composition step uses subtraction instead of fusion. Cut-extrude is visually presented in the preview as a red volume — the chunk about to be removed — rather than showing the void, which would be invisible.

### Live Preview

The preview shown while dragging a distance slider is built entirely in the browser, in `preview.ts`, with no kernel call. For an extrude, it ear-clips the outline into triangles for the top and bottom caps and generates side-wall quads. For a revolve, it sweeps the profile around the axis in slices using Rodrigues' rotation formula. For a sweep, it transports the cross-section along the path with parallel-transport frames. End conditions are approximated — `throughAll` uses a large visual fallback distance. The preview is translucent, slightly faceted for curves, and updates every keystroke. The moment the user commits, the real kernel builds the precise result. The preview is an intentional useful approximation, not a substitute for the real geometry.

When an extrude or cut is committed, the source sketch is automatically hidden. A consumed sketch floating inside a solid is visual noise; hiding it is a formal requirement.

## Finishing Features: Fillet, Chamfer, Shell, Patterns

Finishing features do not build geometry from a sketch — they modify existing bodies. This creates a fundamental challenge: they must reference specific edges or faces on a body that does not exist until the part is built, and the kernel renumbers its topology on every boolean operation. "Edge seven" today may be "edge twelve" after an upstream change.

The solution across all finishing features is to store picks by geometry rather than by internal id. When a user clicks an edge to fillet it, the system stores an `EdgeRef3D` — the two endpoints in world-space coordinates. On rebuild, the kernel finds the edge on the current body whose endpoints are closest to the stored ones. The matching even tries both pairings (start-to-start and start-to-end) because the edge's traversal direction may have flipped. Face picks use a `ShellFaceRef` — a face id plus a fallback origin and normal — matching by centroid and normal if the id is no longer found. Vertex picks carry a fallback position. The id is the fast path; the geometry snapshot is the safety net.

### Fillet

Fillet rounds edges, carrying a list of `EdgeRef3D` picks and a single `radius`. A reserved per-edge `value` field exists for eventual multi-radius support, but the common case is one radius for the whole set.

**Tangent propagation** (on by default, toggle available) automatically expands a single edge pick to the full smooth chain. The module `tangentPropagation.ts` does a breadth-first walk from the clicked edge, testing each neighbor with a dot product of the edge tangent vectors at their shared endpoint. Edges whose tangents align past a threshold (cosine of 5°, approximately 0.996) are added to the chain; a real corner terminates the walk. The absolute value of the dot product is used because antiparallel tangents at a shared endpoint (two edges heading opposite directions along the same line) are still smooth. One click on a circular hole rim fillets the entire rim.

### Chamfer

Chamfer bevels an edge at an angle rather than rounding it. Three modes cover production requirements: equal distance (symmetric 45°), two distances (asymmetric), and distance-plus-angle. The feature carries `distance`, `mode`, and either `distance2` or `angle` depending on the mode.

### Shell

Shell hollows a solid into thin-walled geometry. The user picks the faces to leave open and supplies a wall thickness; the kernel offsets all other faces inward and removes the open ones. The shell operation is acknowledged as one of the touchier kernel operations — it can produce malformed geometry while reporting success. An explicit empty-geometry check runs after the kernel returns; even a "successful" result is rejected if it is empty or malformed.

### Patterns

Patterns replicate existing features by applying transforms, implemented in `pattern.ts`.

**Linear pattern:** copies march along one or two directions at specified spacing and count. The implementation walks an i-by-j grid and emits a translation transform for every cell except (0,0), the original.

**Circular pattern:** copies rotate around an axis — either evenly spaced across a total sweep angle, or at a fixed angular step. The pattern emits count-minus-one rotations (the zeroth slot is the original). Each rotation captures the axis as a frozen origin-and-direction snapshot so it survives renumbering.

**Mirror:** one reflected copy across a plane.

**Mirror-body** and **move-copy-body** apply the same transform logic to whole bodies rather than individual features. Mirror-body has a `keepOriginals` flag; move-copy-body has a `copy` flag.

## Datums: Reference Geometry

Datum features produce no solid geometry. During regeneration they are folded into the datum list with no kernel call. They are the scaffolding that makes it possible to sketch on angled faces, mirror across mid-planes, and offset from surfaces. Three datum kinds exist, each with multiple construction methods, all implemented in `datum.ts`.

### Datum Planes (8 methods)

1. **Offset** — parallel to a plane or face, shifted by a distance
2. **Parallel through point** — parallel to a plane, passing through a picked point
3. **Angle through edge** — tilted around a picked edge by a specified angle
4. **Three points** — the unique plane through three picked points
5. **Mid-plane** — halfway between two faces
6. **Line and perpendicular face** — the plane containing a line and perpendicular to a face
7. **Point and perpendicular edge** — the plane through a point, perpendicular to an edge
8. **Tangent to cylinder** — the plane tangent to a cylindrical face

### Datum Axes (5 methods)

Two points; along an edge; intersection of two planes; axis of a cylindrical face; point and perpendicular face.

### Datum Points (5 methods)

On a vertex; center of a face; center of a circular edge; center of mass of a body; fraction along an edge.

### Parametric Datum Tracking

Datums are not stored as fixed coordinates. They are stored as recipes — "10 mm above that face" — and recomputed during every regeneration against the current geometry. If the referenced face moves, the datum follows. When the reference is a face rather than a stable datum id, the feature stores a frozen plane snapshot (origin and normal) as a fallback. If the face id cannot be found after a renumber, the plane is reconstructed from the snapshot.

### The xz-Plane Right-Hand Bug

A historical fix worth noting: the xz-plane originally had a left-handed basis — its x-axis pointed in the wrong direction relative to the right-hand rule (x × y = normal). The symptom was mirrored sketch text: engrave a part number on the xz-plane and it appeared backwards. The fix flipped the xz-plane's x-axis to negative-x, making all three standard planes consistently right-handed. One-line change, deeply confusing symptom.

## The Hole Wizard

A cut-extrude of a circle can drill a hole, but real holes for real fasteners follow hardware standards with specific dimensions. The Hole Wizard provides those dimensions automatically, driven by a spec table in `holeSpecs.ts`.

### The Spec Table

Two standards are covered: ISO metric (M2 through M12) and ANSI inch (No. 4 through ½ inch). For each size the table provides: clearance drill diameter, tap-drill diameter, counterbore diameter and depth, countersink diameter and angle, thread pitch, and thread major diameter. All values are stored in millimeters — inch sizes are pre-converted at table-authoring time, so a single unit flows through all geometry.

The table exists in two places: a frontend `holeSpecs.ts` (populating the user's dropdown) and a backend `holeSpecs.js` (driving the actual geometry). They must agree perfectly. If the UI believes M4 counterbore is one diameter and the geometry cuts another, the part does not match its own label.

### Placement

The user clicks a face where holes should go. Each click becomes a placement capturing the face, the click position, the face centroid, and the face normal. The click point is the hole center; the face normal is the drill axis. Multiple placements in one feature produce a pattern of identical holes in a single operation.

### Geometry Synthesis

The Hole Wizard adds no new kernel operations. A dispatch helper `_dispatchHole` synthesizes each hole from existing primitives: a plain drill is an extrude of a single-circle profile; a counterbore adds a second wider cylinder on top; a countersink adds a cone from a revolved right-triangle profile. The stack is then subtracted from the body with chained boolean cuts.

A tapped hole uses the tap-drill diameter (smaller than clearance, leaving material for threads) rather than the clearance diameter. The actual thread helix is not modeled — it is expensive, heavy to render, and unnecessary for design intent. Instead, tapped holes receive a **cosmetic thread**: a frontend-only translucent thread shell drawn around the bore. The bore is real geometry; the thread appearance is an annotation. This is the same approach SolidWorks takes.

Every dimension from the spec table has an override field. The spec table wins by default; an override wins when a shop has reason to deviate.

## Equations: Driven Dimensions

### The Concept

Instead of typing the same number in twenty places, a designer defines variables. `width = 20`. Elsewhere: `length = 2 * width`. An extrude distance set to `width / 4` becomes 5 whenever `width` is 20 and updates automatically when `width` changes. This is the equations system — SolidWorks-style global equations stored in a JSONB column on the model record.

### Two Entry Flavors in One Map

The equations document is a map with two kinds of keys. **Global names** (`width`, `length`) are named variables that can be referenced anywhere. **Target paths** (`feature.someId.distance`, `sketch.someId.constraint.someOtherId`) are dotted strings naming a specific driven parameter in the model. Both appear together in the equations panel so the designer sees them in one view.

Each entry has an expression (the formula text), a `lastValue` written back after resolution, and an optional `error`.

### Resolution: Dependency Graph and Topological Sort

The resolver, `resolveEquations` in `equations.ts`, parses every expression with `expr-eval`, a small safe math evaluator. `expr-eval` reports which variables each expression mentions, enabling dependency-graph construction. The resolver then topologically sorts the graph — a three-color depth-first search (white/gray/black) finds an evaluation order where every dependency precedes the expressions that use it. Evaluation then proceeds in that order, so `length = 2 * width` always sees a finished `width`.

Cycles (`a = b + 1`, `b = a + 1`) are detected during traversal: touching a gray node (currently being visited) is a back-edge. Rather than hanging, the resolver records a readable "a → b → a" error on every member of the cycle. Errors are per-entry; a parse error or cycle in one equation does not prevent the rest from resolving.

Edge cases handled: a user variable named `length` would collide with a built-in function in `expr-eval`; the resolver shadows built-ins with user variables so `length / 4` parses correctly. Built-in math constants like `pi` and `e` are cleared from the evaluator namespace so user variables with those names win. Reserved names are exported so the UI can warn designers before they create a collision.

### Application Before Dispatch

A backend mirror, `cadEquations.js`, implements the same algorithm on the same JSON shapes. A test suite feeds both implementations identical fixtures and asserts identical output, preventing drift.

The entry point is `applyEquationsToModel`. It resolves the document, walks the feature tree and sketch constraints, and overwrites every parameter whose target path resolved — literally replacing formula text with the computed number. `regenerateModel` calls it as step one, before dispatching any feature. The kernel never knows equations exist.

This sequencing is the linchpin between equations and the cache. The `paramHash` is over *resolved* values. Change a global driving one of ten extrudes: that feature's resolved distance changes, its hash changes, cache miss. The nine others resolve identically, hit the cache. If the hash were over the formula text, every feature mentioning the changed variable would dirty — the two systems would stop cooperating.

The equations panel has two tables: "Variables" (globals, with an auto-promoting empty draft row) and "Used in" (parameter-bound entries with labels like "f20 · distance"). Value columns update live while typing. Every numeric input field accepts an expression.

## Multi-Body Parts and Combine

### Bodies Array

Most parts are one connected solid. Some are easier to build as multiple independent solids that are later joined, subtracted, or intersected. The regen pipeline tracks a `bodies` array where each entry is one solid: id, BRep geometry, parameter hash, faces, topology, and centroid.

### The Merge Flag

Every additive feature carries a `merge` flag (missing = true). `merge: true` (default) fuses the new prism into the most-recent body. `merge: false` seeds a new body. Two extrudes with merge-on produce one fused solid; the second with merge-off adds a separate solid to the roster.

Cut features default to operating on all bodies — every body the cutting prism intersects loses material.

### Body Identity

A body's id is the id of the first feature that created it, so it remains stable across rebuilds. When a boolean splits a body into multiple pieces, the piece whose centroid is closest to the old centroid inherits the original id; other pieces become new bodies with suffixed ids. A cut that annihilates a body removes it from the roster.

Disjoint sketch regions (a circle and a triangle that do not touch) fan out into one body per region, because a single connected solid cannot span disconnected islands. The same fan-out applies when a pattern copy lands disconnected from the original.

### Combine

Combine is the explicit boolean between named bodies. It takes a target body (which survives and keeps its id), a list of tool bodies (which are consumed), and an operation: **add** (union), **subtract** (cut tools out of target), or **common** (keep only overlap). If subtract splits the target, each piece becomes its own body.

All of this resolves to the same underlying kernel operation, `buildBoolean`, with Fuse, Cut, or Common as the mode. The output is decomposed — the result is walked and any multi-solid outcome is split back into independent bodies, so the part tracks its state honestly.

A Bodies panel lists every solid, with show/hide and direct action controls for each.

## Footguns and Honest Limits

**Profile extraction limits.** The clean case — a single closed loop of lines and arcs — walks correctly. The single-circle case has a fast path. Multiple disjoint loops work through a face-walker that splits curves at intersections. Mixed multi-loop profiles with complicated line-arc interactions are more fragile. A fully general curve-aware loop walker that would handle every case gracefully does not yet exist. Sufficiently unusual sketches may produce a "couldn't find a closed loop" error where a commercial tool would succeed.

**The `namingVersion` footgun.** Changing kernel output and forgetting to bump `NAMING_VERSION` causes old cached rows to be reused against new code — the definition of corruption. The constant is deliberately shared and visible, but manual levers get forgotten.

**The `upstreamHash` gap.** The cache key includes an `upstreamHash` field that is currently empty for per-region prisms — no upstream dependency is captured at that layer. Fine given the two-stage split today; if the dependency model grew more complex, this field would need to be populated.

**Geometry-keyed picks are a heuristic.** Matching edges and faces by closest geometry is robust against kernel renumbering — the dominant failure mode. But it has its own failure mode: move an edge far enough in a rebuild, or produce two edges ambiguously close, and the nearest-neighbor match grabs the wrong one. The direction-flip workaround handles the antiparallel case but does not fully solve the general persistent-naming problem. This is the pragmatic 80% solution.

**Previews are honest approximations.** The live preview is faceted where the real geometry is smooth, performs no boolean, and uses a large fake distance for through-all. It is for visual feedback during a drag, not for measurement. The real kernel result is always built on commit.

**Cosmetic threads are not threads.** The bore is real geometry; the thread spiral is a visual costume. No helix exists. A thread-engagement simulation would need real geometry, which is not modeled.

None of these are bugs — they are scoped decisions: approximate where approximate is sufficient, robust-enough where the precise solution is genuinely hard, with clear documentation at every seam.

## Key Points

- The feature tree (`featureTree.ts`) stores an ordered, immutable array of tagged steps — the "recipe." Editing the model means changing a step in the past and replaying forward; order is causal, not decorative.
- Every tree operation produces a new copy (immutable); this makes undo trivial and Angular change-detection reliable.
- The regeneration pipeline (`cadRegenService.js`, `regenerateModel`) resolves equations to plain numbers first, then walks features in order, skipping suppressed/hidden/post-rollback features.
- Profile extraction (`cadProfile.js`, `profile.ts`) canonicalizes coincident corners, detects nested loops (holes), and preserves curve types — arcs stay arcs — so the kernel builds one analytic face per edge, not dozens of chord facets.
- The `DesignBRepCache` keyed by `paramHash` (SHA-256 over resolved inputs) + `namingVersion` lets a rebuild reuse geometry for every feature whose resolved parameters did not change; editing one of ten extrudes causes exactly one cache miss.
- Finishing features (fillet, chamfer, shell) store picks as world-space geometry (`EdgeRef3D`, `ShellFaceRef`) rather than internal ids, because the kernel renumbers topology on every boolean; picks are re-matched by closest geometry on each rebuild.
- Tangent propagation (`tangentPropagation.ts`) walks smooth edge chains via dot-product angle test (threshold: cos 5°), letting a single click select a full circular rim.
- Datum features have 8/5/5 construction methods for plane/axis/point; they are recomputed during every regen against current geometry, so a datum offset from a face automatically tracks that face.
- The Hole Wizard spec table (`holeSpecs.ts`) stores all ISO metric and ANSI inch fastener dimensions in millimeters; hole geometry is synthesized from existing extrude/revolve primitives, and cosmetic threads (frontend-only translucent shell) represent tapped holes without a real helix.
- Equations (`equations.ts`, `cadEquations.js`) resolve a dependency graph topologically before dispatch; the cache hashes *resolved* values so an equation edit is surgical — only the features whose actual numbers changed get a cache miss.
