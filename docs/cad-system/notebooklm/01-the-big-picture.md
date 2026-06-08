# The Big Picture: A Parametric CAD System Inside an Inventory App

This document describes what the CAD system is, why it exists inside a manufacturing inventory application, and how its four major subsystems fit together. The core concept — that a 3D part is stored as a recipe of instructions and rebuilt fresh on demand, not as a saved file — is the load-bearing idea the rest of the system depends on.

---

## Why CAD Lives Inside the Inventory App

The system this CAD module lives in is a manufacturing and inventory web application. It tracks parts, stock levels, barcodes, warehouse locations, orders, and work instructions for a manufacturing shop. The central object in that world is the **Part**: a database record carrying a name, revision letter, part number, category, suppliers, and a bill of materials.

Parts are physical objects. They have shapes. But historically, those shapes lived outside the database — in SolidWorks files on someone's laptop, or on a network share with filenames like `bracket_v3_FINAL_actually_final.sldprt`. The inventory system maintained a rigorous, revision-controlled record of each part (revision A, revision B, locked for manufacturing, full history). The geometry file existed in a completely separate world, with no enforced connection between "revision B of the part in the database" and "which `.sldprt` is actually revision B." They drifted. Constantly. That gap — between the official part record and the geometry — is where real, expensive manufacturing mistakes happen: machining fifty brackets from a stale file.

The obvious partial fix — better file-naming discipline, or a standalone PDM system that manages the CAD files — fails because it still relies on humans being perfect about filenames, and still keeps geometry and part record in two separate systems that must be kept in sync by hand.

The goal of this CAD module is different: geometry should be a **first-class citizen of the same database**, riding the **same revision workflow** as everything else. Not a file that points at a record, or a record that points at a file — the geometry literally is part of the record. Same database. Same revision A, B, C. Same "released and locked for manufacturing" workflow that the wire harnesses and work instructions already use.

When the part record says revision B is released and locked, the exact geometry of revision B is frozen in the database, tied to that revision, physically impossible to drift. A machinist on a tablet sees the released shape — no CAD license, no file to locate, no question of which version. That is the value proposition: not better modeling than SolidWorks, but **unification** — design intent, revision history, and manufacturing data in one system with one source of truth, accessible in a browser with nothing to install.

The browser platform was a reasonable bet: modern browsers have real GPU-accelerated 3D graphics and can run compiled native-speed code inside the page. Onshape proved professional CAD in a browser is viable. On a manufacturing floor full of locked-down tablets and shared machines, zero-install access is worth a great deal.

---

## The Workbench with Four Tools

The cleanest way to hold the whole system in mind is to imagine **one workbench** with **four distinct tools** on it. They share the bench — shared machinery, shared storage, shared viewer — but each does a distinct job.

### Tool 1: The Modeler

The modeler is where a designer works. You sketch a 2D outline on a flat surface — an origin plane or a face of existing geometry — and then give that outline depth or revolution to produce a 3D shape. You stack up steps like that, and that ordered stack of steps is the **recipe** the whole system is built around. The modeler is the kitchen where you write the recipe.

### Tool 2: The Kernel

The kernel is the heavy-duty geometry engine. It is a completely separate program — written in Rust, running on a server — that does the actual geometric math. When the modeler says "push this rectangle profile twenty millimeters," the kernel computes the exact cylinder: every surface, every edge, every topological relationship between faces. That math is decades-of-research hard, and the kernel is the muscle that handles it. The modeler hands the kernel an instruction; the kernel hands back a finished 3D shape.

The separation exists for two reasons. Practically, the best available geometry library — OCCT (Open CASCADE Technology), a thirty-year-old industrial-strength C++ library — cannot be run in a browser. It needs to be its own server process. Architecturally, the clean boundary between modeler and kernel means the kernel is a **replaceable engine**: the modeler sends a request ("extrude this profile this far") and gets back a shape, without caring how the computation works. If a better geometry engine becomes available, in principle you swap the pan without rewriting the kitchen.

### Tool 3: Version Control

Version control is the time machine and filing cabinet. Every time you save your work — called "checking in" — it becomes a permanent, immutable snapshot. You can go back to any prior state, compare two revisions, or branch off to try something risky without touching the main version. The design is conceptually similar to git (the tool software engineers use for tracking code changes), but for 3D parts instead of text.

When a part is finished, you **release** it, which freezes the exact geometry and ties it to the official part revision number. That freeze is where the "no stale files" promise stops being a hope and becomes a physical guarantee. Version control is covered in depth in a later document; for now, the key point is that it is part of the shared machinery on the bench.

### Tool 4: Assemblies

Assemblies are where finished parts come together into a machine. You place several parts in one scene and declare how they relate: "this bolt's shaft goes inside that hole," "these two faces touch," "this face is flush with that one." A **mate solver** then computes the exact position of every part so all those relationships are simultaneously satisfied — the same fundamental operation as SolidWorks or NX assembly mode. From an assembly you can extract a bill of materials, generate exploded diagrams, and check whether any two parts illegally overlap in space.

### One Bench

The four tools share the workbench — the 3D viewer, the measurement tools, the version control machinery, the save/load plumbing. That sharing is not incidental; it is the central design decision. Its implications are discussed in the final section below.

---

## Geometry Is a Recipe, Not a File

### What Gets Saved

When you save a part, the shape itself is not stored. What is stored is an **ordered list of instructions** — called the **feature tree** — for how to reconstruct the shape from scratch. To see this concretely, trace through building a simple bracket:

1. **Origin** — the standard reference planes and axes (X, Y, Z). Every new part starts here. The "origin feature" is free.
2. **Sketch** — draw a rectangle on the floor plane: four lines, corners connected. The saved record is not a picture. It is a structured note: "four lines at these connections, these two sides are parallel, this corner is a right angle, the bottom edge is one hundred millimeters, the left edge is sixty millimeters."
3. **Extrude** — push the rectangle twenty millimeters upward. Saved: "Feature: extrude. Use the previous sketch. Distance: 20 mm. Direction: up." Four numbers and a reference.
4. **Cut-Extrude** — sketch a circle on the top face and cut a hole through the solid. Saved: "Feature: cut-extrude. This sketch. Through everything."
5. **Fillet** — round the four vertical edges. Saved: "Feature: fillet. These four edges. Radius 3 mm."

That is the entire saved representation of the bracket: five lines. No block, no surfaces, no rounded geometry anywhere in the database. Only the instructions to produce them.

### Why Re-Baking Is Worth the Cost

The reason it is worth deriving the shape fresh every time rather than just loading a saved shape is **editability**. Consider a file-based approach: if you save the final baked geometry and later discover the bracket needs to be 120 mm long instead of 100, you face the cake problem — the cake doesn't know it was supposed to be 100 mm. To resize it, you must surgically push faces around and hope nothing breaks.

In the recipe approach, you go back to step 2 and change one number. You then hit go, and the **entire recipe re-runs from that point down**. The box rebuilds itself at the new length. The hole, which the recipe placed relative to the geometry, moves along. The fillets re-round the new edges. The whole part reflows, automatically and coherently, because every downstream step re-executes against the new upstream result.

This works because the hole and the fillets were never stored as positions in space. They were stored as instructions — "cut a hole here," "round these edges" — and instructions still make sense after the box underneath them got larger. The recipe doesn't capture just what the shape is; it captures **why it is** — "this hole is centered," "these edges are rounded," "this wall is two millimeters thick." That preserved intent is what makes cheap design changes possible.

This is what "parametric" means: driven by parameters. Twist a parameter, the model reflows. The cost of re-baking every open is the price of keeping that flexibility.

### Recipe While Alive, Photograph When Frozen

Re-baking on every open would be painfully slow for complex parts with hundreds of steps. Two mechanisms prevent this. First, a **cache**: the system detects when a step's inputs are identical to the last regeneration and reuses the previously computed result, so only genuinely changed steps are re-cooked. Second, the **freeze**: when a part is released for manufacturing, the system bakes the cake one final time and stores the finished geometry permanently, attached to that release. A machinist opening a released part gets the frozen snapshot instantly, with zero geometry computation.

This gives both advantages. While a part is under active design — still changing — it is pure recipe, preserving full flexibility. The moment it is committed to a revision and frozen, the baked snapshot is also stored, because a released revision will never change again. The snapshot is taken from the recipe at a known revision, so it cannot drift. Recipe while it is alive and changing; photograph once it is frozen and done.

---

## Regeneration: The System's Heartbeat

Regeneration is the formal name for "replay the recipe and produce the shape." It is so central that every piece of geometry visible anywhere in the system — in the part editor, in an assembly view, anywhere — is always the output of regeneration. Nothing displayed is "just stored and loaded." It is always freshly derived from a stored recipe.

A single regeneration cycle follows four steps:

**1. Resolve the equations.** Some recipes contain algebraic relationships between parameters — "the length is always twice the width," "this hole diameter matches that boss radius." Before anything is built, the system resolves all these relationships and computes the final numerical value for every parameter. If you changed the width, the length recomputes first.

**2. Walk the feature tree in order, top to bottom.** The system steps through the recipe sequentially: origin, then sketch, then extrude, then cut, then fillet. Each step takes the geometry the previous steps produced and contributes its own operation. The result of each step is passed as input to the next, like an assembly line where each station adds one operation to the part moving down the belt.

**3. For each step, check the cache; on a miss, call the kernel.** Steps whose inputs are identical to a previous regeneration are served from cache instantly. For genuinely new or changed steps, the system packages the instruction and sends it to the kernel over a messaging protocol. The kernel performs the geometry computation and returns two layers of result: the **exact mathematical shape** (precise surface and edge definitions), and a **triangle mesh** (the same shape decomposed into thousands of flat triangles, because that is what a GPU can actually render — the exact shape's costume for the graphics card). Each surface also comes back with a stable name tag and a classification (flat, cylindrical, etc.) used by version control when comparing two revisions face by face.

**4. Draw the triangle meshes.** The viewer draws the triangle costumes and the part appears on screen.

The uniformity of this loop is important. There is no special "load mode" versus "edit mode." Opening a part is a regeneration. Editing a parameter is a regeneration. Undoing a change is a regeneration. Switching to a different revision is a regeneration. It is always the same loop: stored recipe in, replay, displayable geometry out.

Assemblies follow the same heartbeat with one extra move. Instead of building one part's geometry, regeneration fetches the already-built geometry of each component part (if a component is released, its frozen snapshot is used — zero kernel calls). It then runs the mate solver to translate "this bolt goes in this hole" into exact 3D positions, moves each component's triangle mesh into its computed position, and composes one combined scene. Same fundamental loop; the recipe just says "these parts, related this way" instead of "these features, stacked this way."

---

## How You Actually Design a Part

The editor layout will feel immediately familiar to anyone who has used SolidWorks or Onshape — that familiarity is intentional; there are no points for originality in a CAD interface. Across the top is a **tabbed ribbon**: Sketch, Features, Assembly tabs, each revealing the relevant tool buttons. Down the left side is the **feature tree panel** — the recipe shown as a live list that grows as you add steps. The center is the **3D view**: the part on an infinite graph-paper reference floor that you can orbit, zoom, and pan.

### Sketching

To start a new part, you click Sketch and pick a flat surface to draw on. For a blank part, that is one of the three origin planes. The ribbon auto-switches to the Sketch tab. Crucially, you do not drop into a separate flat 2D drawing mode. You stay in the 3D view and draw directly on the plane as it sits in 3D space. The reason is practical: the whole point of sketching is usually to relate a new shape to geometry that already exists. Staying in 3D preserves that context.

After placing lines, circles, and arcs with drawing tools, the sketch is initially **floppy** — nothing pins it down. You constrain it by applying rules: declare an edge horizontal, type a dimension ("100 mm"), anchor a corner to the origin, enforce a right angle. Each rule removes a degree of freedom. When every degree of freedom is removed — when there is exactly one possible shape and position satisfying all the rules — the sketch is **fully constrained**.

The machinery that turns a set of constraint rules into a unique geometry solution is the **constraint solver**. It solves a system of equations in real time as each rule is added. It is not hand-written: the system adopts the same proven solver used by FreeCAD, a serious open-source CAD program, vendored (copied in-house) so it cannot disappear. If the rules are contradictory — "this edge is 100 mm" and "this edge is 50 mm" — the solver refuses and reports the conflict instead of silently producing nonsense.

### Extruding and Cutting

After constraining the sketch, you leave the sketch mode, go to the Features tab, and click Extrude. You point at the sketch, type a depth, and a translucent ghost preview of the resulting solid appears, growing and shrinking as you change the number. That ghost is a quick, cheap approximation drawn by the front end without calling the kernel — necessary to keep up with fast typing without lag. When you confirm, the kernel builds the real, exact solid and the ghost is replaced. A new line, "Extrude 1," appears in the feature tree.

For a hole, the process repeats one level up. Click Sketch, pick the top face of the solid you just created, draw and constrain a circle on it, then use Cut-Extrude instead of Extrude. The cutting volume is often shown in red to make clear this volume is being removed. Confirm, and the hole exists. The feature tree now reads: Origin, Sketch, Extrude, Sketch, Cut-Extrude.

Every line in the feature tree is editable at any time. Double-click to change numbers. Right-click for a menu: rename, hide, delete. Deleting an extrude causes the entire model to rebuild without it. Editing any step causes everything downstream to reflow.

### The Growing Vocabulary of Steps

The same recipe-and-replay pattern scales to full production parts. Beyond sketch-extrude and cut-extrude, the vocabulary of step types includes: **Revolve** (spin a profile around an axis, for anything rotationally symmetric), **Sweep** (drag a profile along a curved path, for pipes and handrails), **Fillet and Chamfer** (round or bevel edges), **Shell** (hollow a solid to a thin-walled box), **Pattern** (stamp out a linear grid or circular ring of copies), and a **Hole Wizard** that knows standardized fastener hole dimensions. Each of these is just another kind of step the recipe can contain. The spine — the ordered feature tree replayed by the regeneration heartbeat — never changes. Only the vocabulary of step types grows.

---

## Parts and Assemblies Are the Same App, Written Once

This is the architectural thesis. The editor that makes a single part and the editor that arranges finished parts into a machine are not two separate programs. They are **the same program with a mode switch**. The 3D viewer, the measurement tools, the File menu, the save-and-version machinery — all shared. Written once, used by both.

### Why Not Two Separate Editors?

A part editor and an assembly editor feel like different jobs — one makes a shape, one arranges shapes. But consider what they share: both show 3D geometry you can orbit and zoom; both let you pick a face and measure a distance; both need to be saved, versioned, branched, compared, and released; both have a File menu; both regenerate from a stored recipe.

The only real difference is the shape of the recipe: a part's recipe is "features stacked to build one shape," and an assembly's recipe is "component parts and the relationships between them." Everything surrounding the recipe is identical.

Splitting that shared substance into two codebases means maintaining two of everything forever, watching them drift apart, fixing a bug in one and forgetting the other, and six months later losing a day to a subtle behavioral difference that no one can trace. That is how systems rot.

### One Bench, Written Once

Instead, the system builds everything-surrounding-the-recipe exactly once, then provides two thin adapters: one that reads and replays a part recipe, one that reads and replays an assembly recipe. The version control does not know or care whether it is storing a part or an assembly — it stores a recipe. The measurement tool does not know whether it is measuring a single part or two parts in an assembly — it measures 3D geometry. The viewer does not know. The File menu does not know.

The version control is genuinely complex software — branches, snapshots, freezing geometry, comparing revisions, the full git-for-shapes machinery. Building it once, in a way that is blind to what kind of document it holds, avoids having to build it twice and keep both copies in sync forever. Same for every other piece of shared machinery.

The workbench metaphor from earlier makes this precise. Four tools on one bench. The bench — the viewer, the version control, the measurement machinery, the regeneration heartbeat — is built once. The four tools (modeler, kernel, version control, assemblies) reach into the same drawers. An assembly is, as a working mental model, almost just a part whose features happen to be other parts.

### The Cost

Unification is not free. The cost is up-front design discipline: to make the shared machinery truly blind to the document type, you must find exactly the right abstraction boundary — the precise seam where "what is the same" cleanly separates from "what is different." Get that seam wrong and you end up with special-case logic smeared through code that was supposed to be shared, making it worse than two separate implementations. The seam here was found carefully, mostly cleanly, with a thin adapter handling the differences that genuinely exist. There are a few places where an assembly requires something a part never would, and those live in the adapter — exactly where that difference belongs.

---

## Key Points

- The CAD module exists to make a part's **geometry a first-class citizen of the same database** as its revision history and manufacturing data, eliminating the version drift that occurs with external CAD files.
- A part is stored as an **ordered list of instructions** (the feature tree) — not as saved geometry. The shape is reconstructed fresh every time it is opened, by replaying the instructions.
- This approach is worth the re-baking cost because the instructions capture **living design intent**: change an early step and everything downstream reflows automatically. Change step two, everything rebuilds.
- At **release**, the baked geometry is frozen and stored alongside the recipe, so released parts load instantly with zero computation — recipe while alive and changing, photograph when frozen.
- **Regeneration** is the universal heartbeat: resolve equations, walk the feature tree top to bottom, check the cache, call the kernel for misses, draw the resulting triangle meshes. Every visible geometry event — opening, editing, undoing, switching revisions — goes through this same loop.
- The kernel is a **separate program** (written in Rust, backed by the OCCT geometry library) that handles computationally intensive solid geometry operations. The modeler sends it a short instruction; it returns an exact mathematical shape plus a triangle mesh for rendering.
- The **constraint solver** — vendored from FreeCAD — resolves the rules applied to a sketch into a unique geometry solution in real time, and refuses contradictory rule sets rather than silently producing garbage.
- **Parts and assemblies use the same editor**, written once. The 3D viewer, version control, measurement tools, and File menu are all shared. Only a thin adapter differs: one reads part recipes, one reads assembly recipes. This prevents the maintenance rot that comes from maintaining two separate implementations of complex shared logic.
- The workbench metaphor summarizes the architecture: **four tools** (modeler, kernel, version control, assemblies) share **one bench** (the common viewer, storage, and regeneration machinery), written once, used by all four.
