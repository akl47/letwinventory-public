# Assemblies and the Unified Architecture (Accessible Overview)

This document covers how the CAD system moves beyond a single designed part into full product assemblies — collections of finished parts arranged and constrained in space — and then explains the architectural decision that allowed all of the version control, editor, and analysis tools built for single parts to work for assemblies without being rewritten.

---

## What an Assembly Is: Instances and Mates

For a single part, the model is a recipe: a feature tree of sketches, extrudes, and cuts that produces one shape on demand. An assembly is a different kind of thing entirely. It is a *scene* — a collection of already-finished parts arranged in space in their proper relationships to each other. The part models already exist; the assembly says how they fit together.

Two concepts underpin every assembly.

**Instances.** Real products use the same component many times. A machine may use forty identical screws, but you designed one screw. In an assembly, you do not make forty copies of the screw's geometry. Instead, you create forty *instances* — lightweight records that each say "I am a reference to part number 17, the screw, and here is where I sit and how I am rotated." Each instance carries three things: the part ID it points at, a translation (where it sits in space), and a quaternion (the rotation — four numbers that encode a 3D orientation without the numerical problems of chaining rotations around individual axes). It also carries a few flags: grounded, suppressed, visible. That is the complete data for one placed part.

The assembly as a whole is a single JSON document called the `assemblyDoc`. It is the one source of truth. The 3D geometry you see, the parts list, the exported file — all are derived from this list. No geometric data is stored directly; it is computed fresh from the document every time the assembly regenerates.

**Mates.** An instance describes *where* a part is. A mate describes a *relationship* between two parts — intent, not coordinates. Instead of recording "the bolt is at X = 42.3 mm," the system records "the bolt shaft is concentric with the hole in the plate." When the plate moves, the relationship still has to hold, so the solver repositions the bolt automatically. Designs that change cleanly require relationships; designs built on hardcoded coordinates require manually re-entering every number when anything shifts.

The system provides eight mate types, each corresponding to something you would say about real parts:

- **Coincident** — two flat faces sit flush against each other.
- **Concentric** — two cylindrical faces share a center axis (the bolt-in-hole case).
- **Parallel** — two faces remain parallel without necessarily touching.
- **Perpendicular** — two faces meet at a right angle.
- **Distance** — two faces stay a specific gap apart.
- **Angle** — two faces hold a specific angle, like a hinge propped open.
- **Tangent** — a curved face touches a flat face at exactly one line, like a ball resting on a floor.
- **Lock** — two parts are glued together and move as one rigid body.

Every mate is defined by picking a face on one part, a face on a second part, and the relationship type. The editor filters the offered types by the geometry of the selected faces: two flat faces can be coincident, parallel, perpendicular, distance, or angle; two cylindrical faces can be concentric; a flat and a curved face can be tangent. Lock is always available. This filtering is enforced by a function called `validMateTypes`, which prevents geometrically nonsensical combinations before they reach the solver.

---

## The Mate Solver: From Rules to Positions

Specifying mates produces a set of rules. Something has to turn those rules into actual positions. That is the mate solver.

The intuition is a web of springs. Each mate is a spring stretched unhappy because its rule is not yet satisfied — the bolt not yet centered in the hole, two faces not yet touching. The solver's goal is to find the arrangement of parts where the total spring tension is as close to zero as possible.

It achieves this iteratively. It looks at the current arrangement, measures how badly each rule is being violated, then computes the direction in which nudging the free parts would reduce total violation fastest. It nudges, re-measures, nudges again, each nudge smaller than the last, until everything settles. This approach is called gradient descent — rolling downhill toward the valley floor where all rules are satisfied. The specific algorithm used is Levenberg-Marquardt, a well-established least-squares method that also underlies fitting a curve through experimental data. For assembly sizes typical in this system, the solver finishes in a few milliseconds and runs in the browser while you drag parts, producing live snapping.

One rule is non-negotiable: at least one part must be *grounded* — pinned to the world. Every mate is relational: "this is concentric with that." None of them fix anything to an absolute position. If nothing is grounded, the solver can satisfy every rule and then slide the entire correctly-assembled group through space indefinitely — infinitely many right answers, which is mathematically the same as none. The system handles this gracefully: if no part is explicitly grounded, it quietly grounds the first part placed, so there is always an anchor without the user having to think about it.

---

## Three Solver Verdicts: Under, Fully, Over-Constrained

After the solver finishes, it delivers one of three verdicts. Understanding them is as important as understanding what the solver does.

**Under-constrained.** The solver found a valid position, but the part retains freedom to move in some directions without violating any rule. A bolt that is concentric with a hole but has no depth constraint is correctly on the axis but can still slide along it or spin around it. Those are free motions — remaining *degrees of freedom*. A free part in 3D starts with six degrees of freedom: translation along three axes, rotation around three axes. Each mate added removes some of them. A single concentric mate removes four, leaving two (axial slide and spin). The solver reports the remaining count precisely, so you can watch it count down toward zero as you add mates.

**Fully constrained.** Zero degrees of freedom remain. The part cannot move in any direction without breaking at least one rule. This is the normal goal state for a finished assembly — every component exactly located, nothing able to shift.

**Over-constrained.** The rules contradict each other. A simple example: applying a distance mate of 10 mm between two faces, then a second distance mate of 20 mm between the same two faces. No arrangement satisfies both simultaneously. A solver that silently averaged the conflict and settled at 15 mm would produce a model that *looks* fine but is secretly wrong. This system surfaces the contradiction loudly: if the total constraint error cannot be driven to zero regardless of how long the solver nudges, it stops, flags the state as over-constrained, and shows the conflict rather than hiding it.

The degree-of-freedom count also catches a subtler case: redundant constraints. When two rules describe the same restriction, they should count as one, not two. The solver builds a sensitivity table — essentially, how each rule responds to small movements of each part — and computes the *rank* of that table. Rank measures the number of genuinely independent directions of control the rules provide. Two rules that say the same thing have rank 1 together, not rank 2. The degrees of freedom remaining equals six-per-floating-part minus the rank. This calculation is what produces the exact numbers confirmed by the system's specification tests: one coincident mate on a free part leaves three degrees of freedom; one concentric mate leaves two; three coincident mates at right angles leave zero.

The solver is therefore two things at once: a positioning tool that computes where parts go, and a *checking* tool that tells you whether your design intent is complete, unambiguous, or contradictory. The same solver logic runs twice — once in the browser for live, responsive dragging, and once on the server as an authoritative pass whenever the assembly is saved. The server copy produces the canonical, reproducible positions stored with the document.

---

## The Assembly Toolbox

Beyond mates and the solver, the system provides a set of tools organized around three purposes: creating more instances efficiently, visualizing the assembly in different ways, and interrogating it for design information.

### Creating More Instances

**Patterns** take one placed instance (the seed) and stamp out copies in a regular arrangement. A *linear* pattern produces a row — "ten brackets, 25 mm apart." A *circular* pattern distributes copies around an axis — "eight bolts evenly around this bolt circle." The pattern is stored as a rule, not as N separate instances. The document records the seed plus the pattern specification; the copies are expanded at draw time. This keeps the document compact and allows all copies to share the seed's already-computed geometry — the mesh is computed once and placed N times.

**Mirror** produces a true geometric reflection of an instance across a plane, creating genuine left-hand and right-hand versions of a part. A rotation cannot convert a left-hand part into a right-hand one; only a true reflection does. A subtle detail of mesh rendering makes mirror non-trivial: every triangle in a 3D mesh carries a winding order — the sequence of its corners that tells the renderer which face is outward. Reflecting a mesh reverses that order, making all surfaces appear to face inward. The mirror operation therefore performs a second step — flipping the second and third corner of every triangle — to restore outward-facing normals. Without this, the mirrored part renders as a visual void.

**A known limitation:** the screen mesh of a mirrored instance is correctly reflected. However, the precise mathematical solid (the boundary representation used when exporting to STEP for a machine shop) is not yet reflected on export — the seed's exact solid is used instead. This affects only mirrored instances on export. Linear and circular patterns export precisely. The limitation is documented in the codebase with a comment indicating where the fix belongs.

**Subassemblies** allow an entire assembly to be placed inside a larger assembly as if it were a single component. A fully mated gearbox becomes one item in a car assembly. The system resolves nested assemblies by recursing: regenerating each subassembly first, then placing the resolved result in the parent. The one forbidden case is circularity — an assembly cannot contain itself, directly or through any chain of references. A cycle check walks the reference chain before allowing a new connection; if the proposed link would create a loop back to the starting assembly, the operation is rejected with an explicit error. The direct case (same part ID) is caught immediately without a database query, keeping the guard fast.

### Viewing the Assembly

**Exploded views** pull all parts apart to show how they fit together — the style of diagram used in assembly instructions. The editor provides a slider from zero (fully assembled) to one (fully exploded) that animates smoothly. An auto-explode function finds the geometric center of the whole assembly and pushes each part outward radially, producing a usable starting explosion in one click. Crucially, the exploded view does not modify the assembly. Each part's display position receives an additional offset scaled by the slider value, applied at the last moment before drawing. The underlying mated positions are unchanged; sliding to zero restores the assembled view exactly.

**Display states** are saved show/hide configurations. Any combination of hidden instances can be captured under a name — "frame only," "electronics only," "no fasteners." Recalling a state by name restores the visibility list without manually toggling individual parts.

**Section views** slice the assembly with a cutting plane, allowing the interior to be inspected — whether parts actually fit in the space available, whether wiring has clearance, whether internal geometry is correct. The renderer simply omits anything on the far side of the plane. This capability lives in the shared 3D viewer component rather than in the assembly editor specifically, which means it is also available in the single-part CAD editor. It was written once and both contexts received it automatically.

### Interrogating the Assembly

**Interference detection** answers whether any two parts occupy the same physical space — a condition that is impossible to manufacture. Detection runs in two phases. The broad phase is cheap: compute an axis-aligned bounding box for each part (the smallest box enclosing the whole part), then test whether any two boxes overlap using six number comparisons per pair. Most distant parts fail this test and are discarded instantly. The narrow phase is expensive: for the small number of pairs whose bounding boxes do overlap, perform an exact geometric boolean intersection using the kernel. If the intersection is non-empty, that is a real interference. Pairs belonging to the same instance are skipped — a component cannot interfere with itself, only different instances can collide. If the geometry kernel is unavailable, the system degrades gracefully to reporting bounding-box candidates rather than silently providing no information.

**Mass properties** report total volume and center of mass for the whole assembly. Total volume is a sum of each instance's individual volume, already known from kernel computation of each part. Center of mass is a volume-weighted average of each part's center in its *assembled* position — the part's center is transformed by its placement before contributing to the sum, so the result reflects the balance point of the actual product, not of parts piled at the origin.

### Bill of Materials

The bill of materials (BOM) is a parts list: which parts appear in the assembly and how many of each. Rather than being typed manually, it is derived automatically by counting instances in the `assemblyDoc`. Three instances pointing at part A, one pointing at part B — the BOM reads "A × 3, B × 1." Suppressed instances do not count. No one transcribes the list; it cannot fall out of sync with the design because it is computed from the same document.

A sync operation pushes the derived BOM into the existing inventory database tables that the rest of the manufacturing system already uses — ordering, kitting, and planning tools read from those tables without any modification. The CAD-derived parts list becomes indistinguishable from any other BOM in the system the moment it is synced. Because an assembly is itself a part with a part number, an assembly can appear as a line item in a parent assembly's BOM, and the nesting mirrors the subassembly hierarchy.

**Assembly export** produces a single 3D file — STEP for precise CAD interchange or STL for mesh exchange and 3D printing — with every part in its assembled position. The export applies each instance's placement transform to its exact solid geometry and writes the results as one unified model. For released assemblies that have been frozen as official revisions, the export reads the stored frozen geometry directly rather than recomputing, guaranteeing byte-for-byte consistency with what was approved. The mirror-export limitation noted above is the only departure from full precision.

---

## The Unified Architecture: One Machine, Two Pods

The deepest design decision in the system is not a feature — it is a structural choice about what gets written once versus twice.

The natural instinct when adding assembly support to an existing single-part CAD system is to copy the existing infrastructure and modify it: a separate assembly editor, separate version control, separate comparison tools, separate freeze-and-release pipeline. This approach ships quickly. Six months later, a bug is fixed in the single-part version control — a race condition where two concurrent releases can corrupt history — but the assembly version control, forked six months earlier, still has the bug. Two systems that were "basically the same" at creation drift silently apart with every change. Every new feature is built twice. Every bug has two chances to be fixed, but only one chance to actually be noticed.

This system makes the opposite choice. The version control system, the editor, and the analysis tools are each written *once*. Single-part CAD and assemblies plug into those shared components rather than duplicating them.

The mechanism that makes this possible is a clean separation between what is universal and what is document-specific. The universal machine handles everything that does not depend on what kind of document it is processing: locking a document so two concurrent users cannot clobber each other, creating a commit, branching, walking the commit graph for history display, diffing two versions, running the review-and-approve workflow, freezing geometry at release. None of this requires knowing whether the document inside is a feature tree or a component list.

The document-specific questions — "how do I serialize myself to be saved," "how do I deserialize myself when read back," "how do I regenerate my 3D geometry from my document" — are answered by a thin layer called a *binding*. There are two bindings: one for CAD documents, one for assembly documents. Each binding is a small set of functions. The CAD binding says: "my document is a feature tree plus sketches; here is how I turn it into 3D bodies." The assembly binding says: "my document is a component list and a mate list; here is how I run the solver and produce a scene of placed meshes." Everything else flows from the shared machine, which never inspects which binding is plugged in.

**The concrete result:** when assembly support was added by implementing the assembly binding, branching immediately worked. The locking mechanism that prevents concurrent edits immediately worked. The visual history graph that draws commits and branches immediately worked, because it operates on the generic content-addressed object store, not on anything part-specific. Comparing two versions immediately worked. The freeze-on-release that snapshots exact geometry immediately worked. None of those capabilities were written for assemblies — they were already there.

**The editor follows the same pattern.** There is one editor component in the frontend. A flag derived from the URL — set by the assembly route, absent from the part route — determines whether the editor is in assembly mode. In assembly mode, the component-and-mate panel replaces the sketch-and-extrude panel, and the save/branch/release actions point at the assembly document type. The 3D viewer is identical. The version-control panel — checkout, check-in, branches, history, compare, release — is identical, aimed at a different document. The measurement tools are identical. Section view, living in the shared viewer, works in both modes without any assembly-specific code.

**Efficiency of comparison** comes from the same content-addressed object store described in the version control context. When diffing two versions of an assembly, identical chunks of the document have identical fingerprints. Two chunks with matching fingerprints are identical — no further examination needed. Only chunks with different fingerprints require real diff work. This holds for both part documents and assembly documents, because the fingerprinting is document-blind. The only assembly-aware element in the diff engine is a small labeling step: it can emit "Component such-and-such changed" instead of a generic description. The algorithm that determines *what* changed is entirely shared.

---

## Why "Written Once" Compounds in Value

The architectural payoff is not aesthetic. It is concrete and accumulating.

**Correctness is easier to maintain.** The version control logic — the most complex, concurrency-sensitive part of the system — exists in one place. A fix applied there applies to both parts and assemblies simultaneously and instantly. The class of bugs where one copy is fixed and the other is not is structurally impossible when there is only one copy.

**New capabilities land on both sides automatically.** Any enhancement to the shared machine — a richer diff view, an improved merge strategy, a new workflow state, a performance improvement to the commit-graph traversal — ships to both single-part CAD and assemblies on the day it is built, with no additional work. Each improvement delivers double the user value for the same implementation effort, and this compounds: every future improvement follows the same pattern, indefinitely.

**The discipline that produced this outcome** was resisting the faster initial path. Copy-paste feels productive for roughly a month; afterward it becomes a permanent tax on every change. The alternative is identifying the precise, narrow seam where two things genuinely differ — in this case, only "how do I save myself" and "how do I rebuild my geometry" — making exactly that swappable, and sharing everything else without exception.

---

## Key Points

- An assembly is a JSON document (`assemblyDoc`) containing a list of *instances* (part reference + translation + quaternion) and a list of *mates* (relationship rules between pairs of faces on different parts). All geometry is derived on demand — nothing geometric is stored directly.
- Mates encode design *intent* rather than absolute coordinates, so design changes propagate automatically rather than requiring manual coordinate re-entry.
- The mate solver uses iterative gradient descent (Levenberg-Marquardt) to minimize total constraint violation; it runs in the browser for live interaction and on the server for authoritative saved positions.
- The solver delivers three verdicts: *under-constrained* (wiggle room remains, reported as exact remaining degrees of freedom), *fully constrained* (zero remaining), or *over-constrained* (rules contradict and the solver cannot converge to zero error).
- Mirror requires a winding-order fix to prevent surfaces rendering inside-out; the screen mesh is correct, but the precise exported solid for mirrored instances is not yet reflected on export — this limitation is documented in the code.
- The bill of materials is always derived by counting instances in the document, never typed manually, and can be synced directly into the existing inventory tables used by ordering, kitting, and planning tools.
- The version control system, editor, and analysis tools are each written *once*; single-part CAD and assemblies connect to them through thin document-specific bindings that answer only "how do I serialize" and "how do I regenerate geometry."
- The practical consequence of the unified architecture is that branching, locking, history, comparison, freeze-on-release, and the full editor UI were all immediately available to assemblies with no duplication of code.
- Content-addressed storage means version comparison is efficient for both document types: chunks with identical fingerprints are skipped without examination; only changed chunks require diff work.
- Every future improvement to the shared machine automatically benefits both single-part CAD and assemblies, making the architectural investment compound in value over time.
