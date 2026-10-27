# Assemblies and the 3D Mate Solver

This document covers how the CAD system represents, regenerates, and constrains multi-part assemblies. The centerpiece is the mate solver — a Levenberg-Marquardt least-squares engine that positions parts relative to each other by driving geometric error to zero. Surrounding it are the data model that keeps assemblies compact, the regeneration pipeline that turns that data into renderable geometry, eight mate types with their residual formulas, pattern and mirror tools, visualization features, interference detection, mass property analysis, and the bill-of-materials sync path.

## The Assembly Document: Instances and Mates

An assembly is stored as a single JSON document called the `assemblyDoc`. Its structure is intentionally minimal: two primary lists — *instances* and *mates* — plus counters and auxiliary lists for patterns, exploded-view offsets, and saved display states.

An **instance** represents one placed copy of a part. Each instance carries an `instanceId` (e.g. `i1`, `i2`), a `partID` pointing to the part being copied, and a `placement` consisting of a `translate` (x, y, z position) and a `quaternion` (four-number orientation encoding — quaternions avoid the gimbal-lock problems of Euler angles). The same part can appear as many instances: twenty bolts are one bolt part and twenty instances, each with its own placement. Instances also carry three boolean flags: `grounded` (the solver cannot move this part — it is the fixed reference), `suppressed` (the instance is excluded from drawing, solving, and the bill of materials entirely), and `visible` (the part exists and counts in the BOM, but is not rendered). An instance can additionally select a *configuration* of its part — a named variant defined by the part's equations — so five instances of one bracket can be three "short" and two "long" from a single feature tree.

A **mate** is a constraint rule between two instances. Each mate record has a `type` (one of eight), an `a` reference (`{instanceId, faceId}`) and a `b` reference, an optional numeric `value` (used by distance and angle mates), and a `flip` flag that reverses the sense of directional constraints. Face IDs in the document are plain strings like `f2`; the solver translates them to analytic surface descriptions (plane origin + normal, cylinder axis + radius) via a lookup table built during regeneration from the kernel's face classification.

An assembly is itself a **Part** — a row in the same inventory `Parts` table as any bolt or bracket. Eligibility is determined by checking `category.name === 'Assembly'` (the string, not a hardcoded database ID, which would drift between environments). This design decision gives assemblies containment nesting (an assembly instance whose part is another assembly becomes a subassembly) and full inventory participation — BOMs, ordering, kitting, and planning — without any new machinery.

The assembly's live working copy is a row in the same `DesignCADModels` table that holds part working copies, distinguished by an `isAssembly` boolean and storing the `assemblyDoc` JSONB column in place of a feature tree. When an assembly is checked in, a content-addressed *component* object is recorded per instance, pinning exactly which commit of each child part the assembly was built against, and a where-used index row (`VcsUsage`) records the reverse edge — so "which assemblies use this part?" is one indexed lookup.

## Regeneration: From Document to Geometry

The entry point is `assemblyRegenService.regenerateAssembly`. The pipeline runs in five named phases: **resolve → solve → transform → scope → compose**, with a hidden **expand** step between solve and transform for pattern copies.

### Resolve

Resolve fetches a real mesh for each instance. If the instance points to a regular CAD part, that part's single-part regeneration pipeline runs. If the instance points to another assembly, `regenerateAssembly` is called recursively; the finished subassembly geometry is treated as a single rigid blob by the parent. A frozen-geometry reuse path (loading a released, content-addressed mesh without re-running the kernel) is planned but not yet wired — current resolve always performs live regeneration.

### Solve

If any mates are present, the mate solver runs and computes a final pose for every non-grounded instance. Assemblies with no mates skip this step entirely and use stored placements directly.

### Expand (between solve and transform)

Pattern rules are expanded here: the seed instance's already-resolved mesh is stamped into multiple copies at computed positions. No additional kernel work is done — the seed geometry is reused. Pattern copies are manufactured in memory and never written to the document.

### Transform

Each instance's mesh — produced at the part's own local origin — is moved into assembly space by multiplying every vertex and surface normal by the instance's placement matrix. This is plain matrix arithmetic, not a kernel call, so it costs nothing relative to OCCT geometry operations. Normals are also rotated so lighting remains correct after orientation changes.

### Scope

Within a single part, face and body names are short: `f0`, `f1`, `body0`. When multiple instances of the same part appear in one assembly, those internal names collide. Scoping resolves this by prefixing every face and body ID with the instance ID and a `::` separator: instance `i1`'s face `f2` becomes `i1::body0::f2`. In a subassembly, the prefix nests — the path grows longer as depth increases but remains globally unique. The double colon is a separator character that does not appear inside normal IDs.

### Compose

Every scoped, transformed instance is accumulated into one combined result: all faces, vertices, edges, and body lists, plus a per-instance roster that records which body IDs belong to which instance. This roster lets the viewer answer "which part did I click?" even after everything has been merged. Each body in the composed result also carries its untransformed BRep (the precise kernel solid, still at the origin), its placement, its volume, and its centroid. The mesh is moved eagerly for rendering; the BRep is kept in place and moved lazily only when export or interference analysis actually needs it. Volume and centroid travel with each body for mass property computations.

## The Mate Solver: Setup

The solver lives in `mateSolver.ts` (browser, TypeScript) and `assemblyMateSolver.js` (server, plain JavaScript). The two files contain character-for-character equivalent math. The browser version runs during interactive dragging — no server round-trip — for instant visual feedback. The server version is authoritative: it re-solves from scratch on save, and its result is what gets stored. They are kept deliberately in sync.

### The problem formulation

Each mate rule produces one or more **residuals** — scalar error values that measure how far the current assembly configuration deviates from satisfying that rule. When every residual is zero, every rule is satisfied and the assembly is correctly positioned.

The solver's independent variables are the **twist vector** `x`: six numbers per free instance (three position components, three rotation components — the six degrees of freedom of a rigid body in space). If three instances are free, `x` has eighteen entries. The solver finds the values of those entries that drive all residuals to zero.

**Auto-grounding:** if no instance has `grounded: true`, the solver automatically pins the first instance. An assembly with no fixed reference is mathematically undetermined — all parts can drift together without violating any mate. Grounding the first instance follows the same convention as SolidWorks and ensures a stable reference frame.

## The Mate Solver: Levenberg-Marquardt

The algorithm is Levenberg-Marquardt (LM), implemented in approximately four hundred lines of `mateSolver.ts`. It solves non-linear least-squares problems — minimizing the sum of squared residuals — by blending two complementary strategies.

### Gradient descent vs. Gauss-Newton

Pure gradient descent computes the slope of the total error (the first derivative) and takes a small step in the downhill direction. It is safe but slow, prone to zigzagging. Gauss-Newton additionally estimates the curvature and uses it to jump directly toward the predicted minimum. When the estimate is good, Gauss-Newton converges in a handful of steps. When far from the answer or in a curved landscape, it overshoots wildly.

### The lambda dial

LM combines both by introducing a single scalar **lambda**. Small lambda produces Gauss-Newton behavior (large, confident steps). Large lambda produces gradient-descent behavior (small, cautious steps). After each proposed step:

- If the step **reduced** the total error: accept it, halve lambda (be bolder next time).
- If the step **increased** the total error: reject it, multiply lambda by four (be more cautious), and retry from the same position.

The solver retries a failed step up to eight times before advancing the outer iteration. This makes the algorithm self-tuning: it is aggressive when making progress and conservative when struggling. The apparent "physics wobble" when a part snaps into place — a slight overshoot followed by correction — is LM's lambda negotiation visible in real time, not a simulation of physical momentum.

### The Jacobian by finite differences

The Jacobian is the matrix of partial derivatives: row per residual, column per degree of freedom, each cell answering "if I wiggle this knob by a tiny amount, how much does this residual change?" LM needs the Jacobian at every iteration to compute its proposed step.

Rather than deriving analytic formulas for each cell, the solver uses **numerical differentiation (finite differences)**. For each knob, it nudges the value by `1e-6` (one millionth of the relevant unit), recomputes all residuals, and divides the change by the nudge. This measured ratio is the slope. Repeating for every knob fills the entire Jacobian from measurements alone.

Finite differences are slower than analytic derivatives (filling one column requires a full residual evaluation, so eighteen knobs means eighteen evaluations per iteration) and introduce a tiny approximation error. The trade-off is robustness and development speed: every new mate type only requires a residual function; the Jacobian is derived automatically. For assemblies of the scale this system addresses (tens to low hundreds of parts), the numerical Jacobian finishes in milliseconds. Switching to analytic derivatives is documented as an explicit performance follow-up for when assembly size demands it.

### One iteration, end to end

1. Compute all residuals at current poses.
2. Build the Jacobian by poking each knob.
3. LM computes a proposed step from the Jacobian and the current residuals.
4. Tentatively apply the step and recompute total error.
5. If improved: keep the step, shrink lambda. If worse: discard, grow lambda, retry (up to eight times).
6. Check stopping conditions: total error below `1e-7`, or step size negligible.
7. If not stopped: loop from step 1. Maximum 80 iterations.

## The Eight Mate Types and Their Residuals

### Coincident

Two flat faces flush against each other — the most common mate. Coincident encodes two conditions simultaneously: the faces must be anti-parallel (normals pointing in opposite directions, or parallel if `flip` is set), and the gap between them must be zero. This produces four residual components: two from the orientation difference and two from the separation. All four must reach zero for the mate to be satisfied.

### Parallel and Perpendicular

Orientation-only mates; distance is unconstrained. **Parallel**: the cross product of the two face normals is the residual (three components). The cross product is exactly zero when two vectors are parallel, so this is a clean geometric residual. **Perpendicular**: the dot product of the two normals is the residual (one component). The dot product is zero when two vectors are at right angles. Both exploit fundamental vector algebra identities.

### Distance and Angle

Parameterized mates with a `value`. **Distance** is structured like coincident but instead of zero gap the residual is "actual gap minus the target value." **Angle** measures the angular deviation between two faces from the target angle. These two mates make an assembly parametric: change the stored value, the solver repositions the parts.

### Concentric

Two cylindrical surfaces sharing a common axis — a shaft in a bore. The rule has two parts: the axes must be parallel (cross-product residual, three components) and they must be coincident in space, with no lateral offset (offset residual, three components). Six residual components total. When all six are zero, the shaft is dead-center in the hole. Concentric intentionally leaves two degrees of freedom unconstrained: translation along the shared axis and rotation around it. A bolt in a hole can still slide in/out and spin until additional mates stop it.

### Tangent

A cylindrical surface touching a flat face — a pipe resting on a table, grazing along a line. Two residuals: the cylinder axis must be parallel to the plane (orientation), and the distance from the axis to the plane must equal the cylinder radius (contact condition). When both are zero, the round surface just kisses the flat one.

### Lock

Lock freezes two instances in their current relative position: they move together as a rigid group regardless of what other mates do. Its residual is not a fixed geometric formula. At the very start of each solve, the solver captures the current relative pose of the two locked instances and stores it in a module-level map. For the remainder of that solve, the residual is the deviation from that captured snapshot. The map is cleared at the end of every solve call — state does not leak between frames during interactive dragging.

## Constraint State: Under, Fully, and Over-Constrained

After solving, the system reports one of three verdicts about the assembly's constraint state.

The number of remaining **free directions** — ways the parts could move without violating any mate — is computed as: (total degrees of freedom in the twist vector) minus (rank of the Jacobian at the converged solution). Rank counts the number of genuinely independent constraints, seeing through redundancy. Remaining free directions greater than zero means **under-constrained**: the parts can still move.

If the solver converges (total error falls below tolerance) and free directions equal zero, the verdict is **fully constrained**: exactly one valid arrangement exists.

If the solver fails to converge within its iteration budget — no setting of the knobs satisfies all the rules simultaneously — the verdict is **over-constrained**: the mate rules contradict each other.

Specific examples guaranteed by tests: one coincident mate on a free part leaves three free directions (slide on the face plane in two directions, spin around the normal). Concentric leaves two (slide and spin along the axis). Three orthogonal coincident mates leave zero (fully constrained). Two conflicting distance mates on the same face pair produce non-convergence (over-constrained). The Jacobian built for solving yields the constraint verdict essentially for free — two uses of the same data structure.

## The Face-ID-to-Surface Bridge

Mate documents store face references as string IDs (`f2`, `f5`). Every residual formula requires analytic surface descriptions: a plane needs an origin point and a unit normal; a cylinder needs an axis direction, a point on the axis, and a radius. A translation step runs before solving. During tessellation, the kernel classifies each face — flat, cylindrical, or other — and reports the analytic parameters. The regeneration pipeline builds a per-instance lookup table from these classifications. When a mate is evaluated, its face IDs are resolved through this table to pure geometry. If a face ID cannot be resolved (the face no longer exists, or the surface type is not mateable), the mate is skipped with an error recorded, and the rest of the assembly continues solving. One broken mate does not abort the full solve.

## Patterns, Mirror, and Subassemblies

### Linear and Circular Patterns

A pattern stores one **seed** instance and a rule. The rule specifies type (linear or circular), count, spacing, and direction. During the expand step of regeneration, copies are manufactured in memory: linear copies are placed at the seed position plus integer multiples of the spacing vector; circular copies are placed at the seed position rotated by integer multiples of the angular step around the specified axis. No new kernel geometry is produced — the seed's resolved mesh is reused for every copy. The document stays small. Pattern count is capped at 1000 copies to prevent accidental server overload from a mistyped value.

### Mirror

Mirror produces a reflected, opposite-hand copy of a part — a true mirror image, not a rotated duplicate. Every mesh vertex is reflected across a chosen plane. Reflecting a 3D mesh inverts face winding (the inside-out problem), so after vertex reflection the indices of each triangle are reordered (two corners swapped) to restore outward-facing normals. A `flip` flag on mirror copies triggers this winding reversal during the transform step.

**The exported solid is genuinely reflected.** For a long stretch this was the system's documented approximation — the rendered mirror was correct while the STEP export silently carried the seed's un-reflected solid, a "silently wrong deliverable." That gap is closed: the full placement chain — rotate, then translate, then reflect — is baked into the exact BRep kernel-side at export time, using the kernel's existing mirror-transform support. The same reflected geometry feeds interference detection, so a mirrored bracket that genuinely collides with its neighbor is reported, and a false collision computed against the unmirrored seed is not.

### Subassemblies and Cycle Detection

Because an assembly is a Part, any instance can point to another assembly. The resolver handles this by recursively calling `regenerateAssembly` on the subassembly, then treating the fully composed result as a single rigid blob for the parent's solve and transform steps. The subassembly's internal mates are solved first; the parent mates position the finished subassembly as a unit.

Cycle detection runs at two layers. Before every edit that could introduce a cycle (insert, replace), `assertAcyclic` walks the full reference graph and rejects the edit if the assembly would contain itself anywhere in the chain. The same check runs at the top of `regenerateAssembly` as a backstop. The simplest case — inserting an assembly's own part ID into itself — is caught without any database query, making it testable in unit tests against either database backend.

When a component is replaced (`replace-component`), the instance keeps its existing placement and all its mates. The mates re-resolve against the new part's faces. If a face the mate referenced does not exist on the new part, the mate surfaces as an explicit error rather than being silently dropped.

## Visualization: Explode, Section, Display States

### Exploded View

Each instance carries an explode offset — a direction and distance — and the assembly has a global factor from 0.0 (fully assembled) to 1.0 (fully exploded). Applying the factor displaces each instance along its offset by `factor × distance`. A slider animating this factor shows the assembly opening and closing. On first use, the Explode button auto-derives offsets by pushing each instance radially away from the assembly's centroid; parts at the exact centroid (zero-length direction, undefined) are instead fanned out along one axis by index. The explode application runs entirely in the browser as a presentation layer over the server's assembled geometry; no server round-trip occurs when the slider moves, and component dragging is disabled while the view is exploded so parts cannot be repositioned against a picture that misrepresents their mated locations.

### Section View

Section view clips the rendered assembly with a flat plane along a chosen axis (X, Y, or Z) at a chosen position. Three.js's built-in clipping plane feature handles the rendering — geometry past the plane is simply not drawn, but the underlying geometry is unmodified. The feature is implemented once in the shared viewer component and used by both the single-part CAD editor and the assembly editor.

### Display States

A display state is a named snapshot of which instances are visible. Saving records the current set of hidden instance IDs. Applying sets every instance's `visible` flag to match the saved pattern. Multiple display states can be stored ("Frame Only," "Electronics Only," "Fully Dressed") and applied instantly. Display states are named patterns of the same `visible` flag described in the instance data model.

## Analysis: Interference Detection and Mass Properties

### Interference Detection

Interference detection checks whether any two parts occupy the same physical volume — a condition that makes a design unbuildable. It runs in two phases.

**Broad phase:** each composed body's axis-aligned bounding box (AABB) is computed. For every pair of bodies, the boxes are compared. If the boxes do not overlap, the parts cannot intersect — the pair is ruled out with trivial arithmetic. In a large assembly, most pairs are eliminated here at negligible cost.

**Narrow phase:** pairs whose bounding boxes *do* overlap are suspicious — they may or may not truly intersect. For each suspicious pair, the kernel applies each body's full placement — rotation, translation, and any mirror reflection — to its stored BRep (the lazy application deferred from compose time) and computes the boolean `common` of the two precise solids. An empty result means they were merely close; a non-empty result confirms true interference.

If the kernel is unavailable, the narrow phase cannot run. The system degrades gracefully by reporting all broad-phase candidates as "potential interferences, unconfirmed." Each result is tagged: confirmed-interfering, confirmed-clear, or candidate-but-unconfirmed. The system reports its own uncertainty rather than failing silently or lying.

### Mass Properties

Mass property computation requires no kernel calls. Each composed body carries its volume (from kernel output during single-part regen) and its centroid (already transformed into world position during the compose step).

Total volume is the sum of all body volumes. Center of mass is the volume-weighted average of all body centroids: each centroid is weighted by its body's volume, the weighted sum is divided by total volume. Bodies that did not report a volume are skipped and counted; the result includes a denominator of "summed N of M bodies" so callers know when the answer is partial rather than receiving a confidently-wrong number.

## Bill of Materials Sync

The bill of materials is derived, never stored. Walking the instance list, grouping by `partID`, and counting (excluding suppressed instances) produces the parts list. A sync operation writes this derived BOM into the inventory system's bill-of-materials records, with the assembly's own `partID` as the parent. It writes one record per distinct component part, with the instance count as the quantity, replacing whatever was there before.

Once synced, every inventory tool — ordering, kitting, planning — works from the CAD-defined structure without any awareness that it came from CAD. The BOM is just a BOM.

**Important nuance:** the BOM counts *authored instances* in the document, not *expanded pattern copies*. A pattern that renders as ten bolts but is stored as one seed instance and a rule contributes one to the count, not ten. This is a deliberate choice — the count reflects the document, not the rendered picture — and is worth remembering when a patterned component's BOM quantity appears unexpectedly low.

## Key Points

- An assembly is a JSON document — `assemblyDoc` — with two primary lists: *instances* (placed part copies with `translate` + `quaternion` placement) and *mates* (geometric constraint rules between pairs of faces). The entire geometry is derived from this document; nothing visual is stored.
- The assembly is itself a `Part` row, identified as an assembly by `category.name === 'Assembly'` (string, not ID). This gives subassembly nesting and the full inventory pipeline — BOMs, ordering, kitting — at no extra cost. Its working copy lives in the same `DesignCADModels` table as parts, flagged `isAssembly`; check-in pins each child part's commit via content-addressed component objects plus `VcsUsage` where-used edges.
- Regeneration runs five phases: resolve (fetch meshes, recurse into subassemblies), solve (run the mate solver), expand (stamp pattern copies), transform (apply placements via matrix math, not kernel calls), scope (prefix face/body IDs with `instanceId::` for uniqueness), compose (accumulate into one combined geometry with a per-instance roster).
- The mate solver is Levenberg-Marquardt (`mateSolver.ts` / `assemblyMateSolver.js`): a self-tuning blend of Gauss-Newton (fast, bold) and gradient descent (slow, safe), governed by a lambda dial that halves on success and multiplies by four on failure, retrying up to eight times per iteration. Max 80 iterations; convergence threshold `1e-7`.
- The Jacobian is computed by finite differences (nudge each knob by `1e-6`, measure residual change, divide). This is slower than analytic derivatives but requires no per-mate calculus and works correctly for every mate type automatically. The switch to analytic derivatives is documented as a performance follow-up for large assemblies.
- Eight mate types: **coincident** (anti-parallel flush faces, 4 residuals), **parallel** (cross-product orientation, 3), **perpendicular** (dot-product orientation, 1), **distance** (gap minus target value), **angle** (angular deviation from target), **concentric** (shared axis: parallel + offset, 6 total), **tangent** (cylinder grazing a plane), **lock** (snapshot-and-enforce current relative pose, cleared between solves).
- Constraint state is determined by the rank of the Jacobian at the converged solution. Remaining free directions = total DOF minus rank. Converged + zero free = fully constrained. Converged + free directions remain = under-constrained. Failed to converge = over-constrained.
- Mirror copies are rendered correctly (vertices reflected, triangle winding reversed) *and* exported correctly — the rotate-translate-reflect placement is baked into the exact BRep for both STEP/STL export and interference detection. The earlier export approximation (unmirrored seed geometry in the deliverable) is fixed.
- Interference detection uses a two-phase approach: AABB broad phase rules out non-overlapping pairs cheaply; kernel boolean-common narrow phase confirms true intersection on surviving candidates. Degrades gracefully to "potential interferences, unconfirmed" when the kernel is unavailable.
- The BOM counts authored document instances, not expanded pattern copies. Pattern copies rendered as ten parts but stored as one seed count as one in the BOM.
