# The Geometry Kernel (Accessible Overview)

This document explains the geometry kernel — the specialized program that does all the heavy solid-shape mathematics in the CAD system. It covers why the kernel exists as a separate service, how the rest of the system communicates with it, the nine fundamental operations it knows how to perform, and two design choices (persistent face names and surface classification) that turn a shape calculator into a full parametric CAD engine.

---

## What a 3D Shape Actually Is

Before understanding the kernel, it helps to understand what it operates on.

A 3D shape stored in a CAD system is not a drawing. It is a *recipe* — a precise mathematical description from which any point on the shape can be computed exactly, at any scale, without loss of detail. A circle in this system is not a stored sequence of points along a curve; it is a center point and a radius. A flat face is a plane defined by a point it passes through and the direction it faces. A cylindrical hole is a centerline and a radius. The shape is described by its underlying mathematical structure, not by a rasterized sampling of it.

This style of representation — describing a solid by describing its complete outer boundary — is called a *boundary representation*, or B-rep. The solid is defined by the surfaces that enclose it (its faces), the curves where those faces meet (its edges), and the points where edges meet (its vertices). The interior of the solid is not stored anywhere; the shell is the complete description, much like a balloon is defined by its rubber skin rather than by the air inside.

A valid B-rep must be *watertight*: every edge is shared by exactly the faces that should bound it, there are no gaps or overlaps, and the entire skin closes up with no holes. The kernel works hard to maintain this property, because a single gap in the topology causes the downstream mathematics to fall apart.

Every face also carries a sense of orientation — an outward-pointing direction called a normal — so the system always knows which side of the surface is "inside the material" and which is "outside." This is what distinguishes a solid brick from a hollow box that looks the same from the exterior.

The important consequence of the recipe model is precision: there is no resolution limit. You can query any point on a cylindrical surface to arbitrary accuracy because the cylinder's definition — its axis and radius — is exact. This is the underlying truth the kernel operates on and preserves.

---

## Why the Kernel Is a Separate Program

The geometry kernel runs as its own isolated process, separate from the web application and the browser-based editor. That separation is intentional and load-bearing, for two reasons.

**The math is specialized and already solved.** Computing the exact shape of a rounded edge, where two curved surfaces blend into each other using a rolling-ball fillet, is genuinely difficult mathematics. Building this from scratch is not a reasonable option for an application team. The kernel is therefore built on top of *OpenCASCADE* (abbreviated OCCT), a large, mature, open-source geometry library that has been in industrial use for decades. It originated inside a commercial CAD system and is the same library that powers FreeCAD. Standing on OCCT means the system inherits battle-tested geometry algorithms — not a weekend reimplementation. The system runs on OCCT 8.0, the current major release of the library.

The kernel itself is written in native C++ — the same language OCCT is written in. That was not the first choice: the original kernel was a Rust program bridging into OCCT through a foreign-function layer. It worked, but every OCCT capability the system needed had to be individually plumbed through the language bridge, and the bridge's build machinery had its own sharp edges. The rewrite to native C++ removed the bridge entirely: the kernel now speaks OCCT's own language and can reach any part of the library's enormous API directly. The rest of the system did not notice the rewrite — the kernel's message protocol stayed identical, which is itself evidence that the "replaceable engine" boundary is real. C++ compiles to fast native code with no runtime layer, which matters because geometry operations are computationally expensive and users are sitting there waiting for a shape to appear.

**Crash isolation.** Geometry kernels crash. Not because they are poorly written, but because the problem space is brutal: ask the kernel to round an edge with a radius that is geometrically too large to fit, and the underlying OCCT math can reach a state it cannot resolve. In the worst case, it hard-crashes the process it is running in rather than returning a polite error.

If the kernel shared a process with the main application, such a crash would take the entire session down — the user loses their work because they typed a slightly too-large fillet radius. Running the kernel as a separate process creates a blast wall: when the kernel crashes, it crashes alone. The application detects that the kernel has gone dark, the container platform relights it automatically, and a clean error is reported to the user — "that operation failed, try a smaller radius." The crash is mostly invisible. No work is lost.

The blast wall actually has three layers, matched to three failure modes. Bad inputs the kernel can *detect* — degenerate outlines, zero-length edges — are rejected up front with a readable error, before OCCT ever sees them. Operations that make OCCT *abort* kill the process, which the container platform immediately restarts fresh. And operations that make OCCT *hang* — spin forever without crashing, the most insidious failure — are caught by a watchdog: every operation is given a deadline, and if the handler runs past it, the watchdog deliberately kills the process so the restart machinery can bring back a clean one. Reject what you can see, restart what dies, and execute what merely hangs.

The cost of that blast wall is operational: the kernel is a second service that must be running, must be reachable, and must be monitored. The editor performs a heartbeat check to confirm the kernel is alive and grays out geometry-dependent controls when it is not. Two buildings must be kept lit instead of one.

---

## How the Application Talks to the Kernel

When the application needs geometry work done, it does not reach into the kernel and call a function. It writes a small, structured message — an order ticket — and sends it over.

The protocol is JSON-RPC: JSON (a standard human-readable text format for labeled values) as the message shape, and RPC ("remote procedure call") as the pattern — ask a separate program to run a function and return the answer. The request is tiny: a few hundred characters naming the operation and its parameters. The response is the finished 3D shape.

The finished shape comes back as *two* things, and understanding both is essential.

The first is the exact B-rep: the real mathematical boundary representation, serialized into a compact form — the sealed envelope containing the chef's recipe. This is stored as the source of truth. Every time something real needs to happen — manufacturing, export to a standard CAD file, precise computation — the system uses this exact representation.

The second is a *triangle mesh*, called a tessellation. Screens and graphics hardware fundamentally draw triangles — every video game, every 3D movie, every CAD viewport is built from flat triangles. A perfect cylinder cannot be drawn by a screen directly. So the kernel approximates the exact shape by covering it with many small flat triangles that, at viewing distance, look smooth. This triangle mesh is what appears on screen.

What you see is therefore always an approximation. The tessellation uses a *chord tolerance* of 0.05 mm (five hundredths of a millimeter): no triangle is allowed to stray further than that from the true curved surface before the tessellator must add more triangles. This tolerance was chosen to match the tolerance the sketch editor uses when rendering 2D curves, so the flat sketch and the 3D solid agree about where a curve lies, down to the same fraction of a millimeter. The seam between them is invisible.

The triangles are for eyes only. The exact B-rep is for everything that matters. The system never confuses the two, and the approximation is quarantined entirely to the display layer.

---

## The Nine Operations: A Working Vocabulary

The kernel knows a small vocabulary of fundamental operations. Almost every manufactured object — a phone case, an engine block, a bracket, a Lego brick — is some combination of these nine verbs.

### Extrude

Extrude is the foundational operation. It takes a flat closed outline and pushes it in a straight line perpendicular to its plane, giving it thickness and turning it into a solid. A circular outline becomes a cylinder; a star outline becomes a star-shaped prism.

The mental model is toothpaste pushed through a shaped opening: the outline is the opening, the extrusion distance is how far you squeeze, and the result is a solid string of that cross-section. The word "extrude" comes directly from this industrial process. A large fraction of all parts in practice begin with "draw an outline, extrude it."

Extrude also supports a *cut* mode: instead of adding material, the extruded profile is subtracted from an existing body, like a cookie cutter pressing through dough and removing the dough beneath. This is how holes, slots, and pockets are made.

### Revolve

Revolve spins a flat profile around an axis to sweep out a rotationally symmetric solid. The profile is the silhouette — draw the side view of a wine glass, spin it a full turn around a vertical centerline, and the complete glass materializes. Anything round-and-symmetric — a bottle, a shaft, a wheel, a turned chess piece — is a revolve.

A potter's wheel is the right mental model: the potter shapes the silhouette and the rotation produces the 3D form.

A careful implementation distinction matters here. Spinning a profile 360 degrees by specifying the number, and spinning it as a "full closed revolve," sound identical but are not. The 360-degree numeric request treats the start and end edges as two separate edges that happen to coincide — leaving a faint visible seam on the surface. The full-closed-revolve request knows to close the surface seamlessly into a single continuous face. The system always uses the seamless form for full revolves.

### Sweep

Sweep is extrude's generalization: instead of pushing a profile in a straight line, it pushes the profile along any path drawn through space. A circular profile swept along a curved path produces a bent pipe, a garden hose, or a cable running through a harness. The profile follows the path as if the tube were being extruded while the extruder head moves.

Sweeping around sharp corners is geometrically hard. The straightforward approach chokes at ninety-degree bends. The kernel uses a method that handles sharp corners gracefully, because real parts — wires, brackets, tubing — have sharp bends constantly.

### Loft

Loft blends smoothly between two or more different cross-section outlines placed on different planes. Where sweep drags one unchanging profile along a path, loft interpolates *between* profiles: a square at the bottom morphing into a circle at the top, a fan blade whose cross-section changes along its length. The kernel constructs the transitional surface that passes through every section in order.

### Boolean

Boolean operations combine two solid bodies using set logic. There are three variants.

*Fuse* glues two bodies into one unified solid. *Cut* uses one body as a tool to carve material out of another — the tool body's shape is subtracted from the target. *Intersect* keeps only the volume where both bodies overlap and discards everything else.

The cut operation is the conceptual heart of how holes are made in CAD: you never draw a hole. You create a cylinder in the shape of the desired hole, position it through the target body, and subtract it. The kernel creates the new inner cylindrical faces where the material was removed. A hole is not a thing — it is an absence, made by subtracting a shape.

If a cut happens to divide a body into two separate disconnected chunks, the kernel detects this and returns two distinct bodies. It re-counts separate solid components after every boolean operation.

### Pattern

Pattern copies a feature according to a repeating rule without requiring the designer to place each copy individually. The linear variant repeats copies in a straight row at a given spacing. The circular variant distributes copies evenly around a center point, like the hour marks on a clock face. The mirror variant reflects a feature to the opposite side of a plane, producing a guaranteed-symmetric counterpart.

All three are parametric: the count, spacing, or angle of the pattern can be changed and every copy updates automatically. The kernel supports two flavors: a *geometry pattern* that stamps out transformed copies of the finished shape (fast, exact copies), and a true *feature pattern* that re-executes the original feature's operation at each pattern location — so a cut that ends "at the next surface" re-evaluates against whatever surface each copy actually meets, the way SolidWorks distinguishes the two.

### Shell

Shell hollows a solid body to a uniform wall thickness, optionally leaving specified faces open. Given a solid block and a 2 mm wall thickness with the top face removed, the kernel produces an open-topped box with 2 mm walls. Every plastic enclosure — a remote control housing, a phone case, a Tupperware container — is a shell.

The kernel validates the result after computing it. If the requested wall thickness exceeds what the geometry can physically support — for example, walls thicker than the narrowest part of the shape — the inner surface has no valid location. The kernel detects this malformed result and rejects it rather than returning a broken shape.

### Fillet

A fillet rounds a sharp edge, replacing it with a smooth blending curve. The mathematical model is a rolling ball: imagine a sphere of the specified radius rolling along the sharp edge, contacting both adjacent faces. The surface traced by the rolling ball is the fillet. A 2 mm fillet is, geometrically, the trace of a 2 mm-radius ball.

This model immediately explains the primary failure mode: if the ball is larger than the faces it must roll along can accommodate — a radius too large for the geometry — the ball cannot fit, and the fillet operation fails. The kernel reports this as an error rather than producing a degenerate shape.

### Chamfer

A chamfer replaces a sharp edge with a flat angled cut rather than a curve — a bevel, like the angled edge of a countertop. Three specification modes are available: equal (the same distance stepped back on both adjacent faces, producing a 45-degree bevel), two distances (different setbacks on each face, for an asymmetric angle), and distance-plus-angle (one setback distance and an explicit angle). All three describe the same family of shape; the choice depends on which parameters the design intent is expressed in.

Fillets and chamfers are typically the last operations applied in a design sequence: the full geometry is modeled first, and edge treatments are added at the end. This matches manufacturing reality — sharp edges concentrate stress, cause cracking, injure users, resist coatings, and are physically impossible for many cutting tools to produce.

---

## The Two Clever Bits

A kernel with only those nine operations would be a capable shape calculator. Two additional mechanisms turn it into a system that supports robust parametric editing and part assembly.

### Persistent Face Names

Parametric CAD is built on the ability to go back and change an early parameter — the height of a block, the diameter of a hole — and have every downstream operation automatically adapt to the new geometry. The kernel re-runs all operations from the beginning whenever a parameter changes, producing geometrically fresh faces. This creates a fundamental problem: how do later operations know which face to act on?

If faces were identified by position in the order they happened to emerge from the mathematics, a change upstream might cause the faces to come out in a different order. A fillet placed on "the top edge" would drift to a different edge or disappear entirely. This is a well-known and notorious problem in parametric CAD called the *topological naming problem*.

The solution is persistent names: every face is given a durable identity tied to *which feature created it and what role it plays in that feature*, not to the accident of its computational sequence. A face is not "face number four." It is "the top cap of extrude feature three" — a description that survives a rebuild. When the block is made taller, the extrude re-runs and produces new geometry, but the top cap is still "the top cap of extrude three." The fillet finds its target by name, not by position.

For an extrude specifically, each produced face is classified by where its center falls along the push direction: bottom-cap (at the start), top-cap (at the far end), or side (everywhere else). The names are therefore role-based descriptions, not positional accidents.

Persistent names are load-bearing throughout the system. Visual diffing between two versions of a part — identifying which faces changed, which are new, which moved — depends on stable face identities to distinguish "the same face in a different position" from "a brand new face." Feature targeting, selection persistence, and history tracking all ride on this mechanism.

### Surface Classification

Assembly design requires snapping parts together along precise geometric relationships: two flat faces sitting flush against each other, a shaft centered in a bore hole sharing the same axis. Both of these operations require exact geometric information — the precise normal of a plane, or the precise axis and radius of a cylinder.

The triangle mesh visible on screen cannot supply this. Triangles are an approximation; no "axis" is stored in a fan of triangles arranged in a rough circle. Estimating an axis from the mesh produces an approximate and unstable result.

The kernel therefore performs surface classification on every face it produces. For each face, it queries OpenCASCADE for the face's true surface type. If the surface is a plane, the kernel records the plane's origin and outward normal — the exact numbers, derived from the B-rep, not the mesh. If the surface is a cylinder, it records the cylinder's axis (position and direction) and radius. These exact analytic values are attached to the face alongside the triangles.

Each face then carries two representations: the triangle mesh, for rendering; and — if the surface is a plane or cylinder — the exact analytic parameters, for computation.

The kernel classifies only planes and cylinders, and this is deliberate. Those two surface types cover the overwhelming majority of how mechanical parts mate: flat face to flat face, and cylindrical shaft to cylindrical bore. For any other surface type — cones, spheres, free-form NURBS — the kernel skips classification rather than emit data nothing downstream consumes. If a future feature requires cone matching, that can be added then.

The classified values are stable in the way that mesh values are not: the axis of a cylindrical hole is a mathematical fact about the cylinder, unchanged by zoom level or tessellation density. An assembly solver can lean its full weight on that axis as a reliable anchor, even as other parameters in the part change and the geometry rebuilds.

The two mechanisms together address different scopes: persistent names give a *part* stable identity across edits; surface classification gives *different parts* the shared geometric language to find and snap to each other.

---

## Known Tradeoffs and Footguns

The kernel has three honest limitations worth understanding.

**Operational overhead.** The blast-wall isolation that prevents kernel crashes from destroying user sessions comes at a cost: the kernel is a second service that must run, must be reachable, and must be monitored. The editor performs a continuous health-check and disables geometry-dependent functions when the kernel is unreachable. This is the right tradeoff — crash isolation alone justifies it — but it is not free.

**Manual rebuilds on a separate cadence.** The kernel is a large native compiled program. Rebuilding it is slow and must be triggered manually; it does not hot-reload like the web application. It is possible to change kernel code, forget the rebuild, and spend time debugging behavior that is actually running the previous binary. As a partial defense, the running kernel reports a build identifier and a naming-schema version on every health check, and the application refuses to regenerate geometry against a kernel whose schema version does not match its own — a mismatched binary cannot silently poison the cache. (An earlier, sharper version of this footgun — the original Rust kernel's language bridge only rebuilt when one specific file's timestamp changed, so header edits silently had no effect — was eliminated by the rewrite to native C++.)

**The display is permanently approximate.** The tessellated triangle mesh on screen is always, by definition, not exactly the true curve. The 0.05 mm chord tolerance means triangles stay within a fraction of a millimeter of the real surface — well below visual detection and well below typical manufacturing tolerances — but the difference is not zero. This is not a deficiency to be fixed; it is intentional. The display is an approximation so that graphics hardware can draw it. Every time anything consequential happens — export, manufacturing, precise computation — the system bypasses the mesh and uses the exact B-rep. The approximation is real and quarantined to the display layer. The screen is allowed to be slightly wrong because the screen was never the source of truth.

---

## Key Points

- A 3D solid in this system is a boundary representation (B-rep): a watertight quilt of mathematically exact surfaces — planes, cylinders, curves — stitched at edges, with a clear inside and outside. It is a recipe, not a drawing.
- The kernel runs as a separate process built on OpenCASCADE (OCCT) 8.0, an industrial geometry library used by professional CAD tools. Separation provides crash isolation: a kernel failure cannot destroy a user's session.
- The kernel is native C++ — the same language as OCCT itself. The original implementation was a Rust wrapper bridging into OCCT; the rewrite removed the language bridge entirely while leaving the message protocol, and therefore the rest of the system, untouched.
- Resilience has three layers matched to three failure modes: detectable bad inputs are rejected with a readable error before OCCT sees them; hard crashes kill the process and the container platform restarts it; hangs are killed by a per-operation watchdog deadline so the restart machinery can recover even from an operation that never returns.
- Application and kernel communicate via JSON-RPC: a small text message goes in (the operation and parameters), a finished shape comes back.
- Every shape is returned as two things: the exact B-rep (stored as source of truth) and a tessellated triangle mesh (displayed on screen). The mesh approximates the B-rep to within 0.05 mm — close enough to look smooth, never used for anything real.
- The kernel's vocabulary is nine operations: extrude, revolve, sweep, loft, boolean (fuse/cut/intersect), pattern (linear/circular/mirror, in both geometry-copy and true feature-re-execution flavors), shell, fillet, and chamfer. Almost every manufactured part is some combination of these.
- Persistent face names solve the topological naming problem: each face carries a role-based identity ("top cap of extrude three") that survives rebuilds, preventing downstream features from drifting to wrong geometry when upstream parameters change.
- Surface classification extracts exact analytic parameters (plane normals, cylinder axes and radii) from the B-rep and attaches them to each face alongside the mesh, giving the assembly system stable geometric anchors that do not degrade with zoom or tessellation density.
