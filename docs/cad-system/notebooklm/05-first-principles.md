# First Principles: How the CAD/Assembly/VCS System Fits Together

This document explains why a parametric CAD system was built inside an inventory and manufacturing web application, how it is divided into four cooperating subsystems, how each type of document is turned into displayable 3D geometry, how version control is the connecting spine, and what technologies underpin each layer. It is the conceptual foundation for every deeper topic in the system.

---

## The Real Problem: Geometry Divorced from the Business Record

Every manufactured part lives in a database of record — a Part row with a part number, revision, bill of materials, stock levels, and work-order assignments. That row is the source of truth the business runs on. When it is wrong, the wrong part gets built.

The shape of that part — the actual 3D geometry — has traditionally lived somewhere else: a CAD file on a file server, named by convention, maintained by a separate product data management (PDM) vault. Nothing formally enforces that the revision label in the filename matches the revision in the database, or that the shape in the file is the shape manufacturing is actually building. The geometry floats next to the record instead of living inside it, and the two drift apart over time. Engineers spend effort maintaining a parallel governance layer — naming conventions, vault check-in rules, manual cross-referencing — just to keep floating files lined up with the database that was supposed to be in charge.

The decision the whole system is built on: **attach a parametric CAD model directly to each Part row.** Not a file reference, not a vault link — the model itself, keyed to the same part identity, versioned by the same revision lineage, stored in the same database.

### Parametric means the recipe, not the cake

A parametric model is an ordered list of operations with editable parameters, not a static mesh of triangles. Instead of storing ten thousand triangles that happen to form a bracket, the system stores: "rectangle 40 by 20; extrude 5 millimeters; two holes of diameter 6 at these positions; fillet these four edges at radius 2." That list is the **feature history** — the recipe. The parameters are editable. Change the 40 to a 60, re-run the list, and the longer bracket's holes and fillets reposition correctly.

The shape is the **output** of replaying the list. The list is the truth. These are not the same object, they do not live in the same place, and one is cheap to store (kilobytes of JSON next to the Part row) while the other is expensive to compute. The feature tree is sacred; the resulting geometry is derived and mostly disposable. That distinction — truth versus derived — is the cleanest line in the system and everything downstream reflects it.

### Why the browser

The inventory system is already a web application. Everyone with a browser tab open to a part record, a BOM, or a work order is already in the right place. Opening CAD in the same tab, with the same login and the same permissions, eliminates the context switch: click a part, click "CAD," start modeling — no install, no license server, no "which machine has the file."

The heavy solid-geometry computation does not have to happen in the browser. The browser is the cockpit — drawing, clicking, orbiting the camera, picking faces. The actual geometry math happens on a dedicated server-side process built for exactly that, and the answer comes back as something the browser can cheaply draw. Cockpit here, engine there; that split is the first big architectural seam.

---

## The Four Subsystems and the Borders Between Them

The architecture is four cooperating subsystems. A good architecture is mostly about where the lines are drawn so the pieces do not bleed into each other.

### 1. The CAD Modeler — conductor, not orchestra

The modeler is everything the user directly touches: sketching a 2D outline, stacking features into a history, walking that history to rebuild the shape, and the 3D viewer used to orbit and click on faces. It spans the browser and the backend, but it is a **responsibility**, not a location.

On the frontend it lives in two main folders. `frontend/src/app/cad/lib/` is the pure modeling library: the sketch solver, the profile extractor, the tessellator, the feature-tree code, the equation resolver. `frontend/src/app/components/cad/` is the Angular UI: the editor host, sketch tools, viewer component.

On the backend, the modeler's job is **regeneration orchestration** — walking the feature tree, deciding what needs rebuilding, calling the geometry engine. That logic lives primarily in `backend/services/cadRegenService.js`.

Crucially, the modeler never does the actual solid-geometry math itself. It is the conductor; the math is the orchestra.

### 2. The Geometry Kernel — the engine room

The kernel is a completely separate program written in **Rust**, wrapped around **OCCT** (OpenCASCADE Technology) — the open-source geometry library that underpins many professional CAD packages. It lives in its own directory (`cad-kernel/src/`) in its own language, behind a network boundary.

The kernel owns all the hard geometry:
- Taking a 2D profile and a distance and producing a real **boundary-representation solid** (a B-rep — the object defined by exact surfaces and edges, not triangles).
- Boolean operations: fusing two solids, cutting one out of another.
- Revolves, sweeps, shelling a solid hollow, edge fillets.
- **Tessellation**: turning exact mathematical surfaces into the triangles the browser can draw.
- **Per-face naming and classification**: assigning each face a stable persistent name and a surface type (flat, cylindrical, spherical).

The kernel runs as its own process. The backend communicates with it over **JSON-RPC over TCP** — structured requests and responses on a socket. If the kernel fails on a pathological piece of geometry (OCCT can throw exceptions or crash on unusual inputs), the web server catches the error and stays up. The backend does not know OCCT exists; it knows there is a thing on a socket that answers geometry questions. The kernel does not know Sequelize or Postgres exist; it knows it receives profiles and returns meshes.

### 3. The Version-Control System — the time machine

The VCS is a git-like, content-addressed store. Every check-in is a permanent, immutable snapshot. It supports branching, comparing versions, merging, and releasing (which freezes geometry and ties it to an official part revision). It lives in `backend/services/vcs/`, with its database models in `backend/models/vcs/` — specifically the `VcsObject` and `VcsRef` tables, stored in the same PostgreSQL database as everything else. There is no separate vault or external system.

"Content-addressed" means data is named by a cryptographic fingerprint of its contents rather than by where or when it was saved. The same content always produces the same fingerprint and is stored exactly once. Two parts that share an identical sketch literally share the same stored object.

### 4. Assemblies — arrangement and composition

An assembly is where finished parts come together into a larger object. Component instances (references to released parts) are placed in a scene with **mates** — geometric relationships such as concentric holes and shafts, coincident faces, fixed distances or angles. A mate solver computes the exact position and orientation of every floating instance that satisfies all relationships simultaneously. From an assembly the system generates a bill of materials, exploded views, interference checks, and combined exports.

Assembly logic is split between `backend/services/assembly*` (server-side regen and mate analysis) and `frontend/src/app/cad/lib/mateSolver.ts` (frontend constraint solving for interactive positioning).

The key architectural decision: **an assembly is itself a Part.** It appears in bills of materials, can be nested inside other assemblies, and rides the exact same version-control machinery as a single-component part. An assembly is a different kind of document that the same system already knows how to store, version, and release.

---

## The Part Regeneration Cycle

Regeneration is the heartbeat of the CAD modeler: a stored feature history goes in, displayable 3D geometry comes out. Here is the cycle in order.

### Step 0: Resolve equations

The document may carry a set of named equations — `length = 40`, `width = length / 2`. Before building anything, the equation graph is resolved to produce concrete numeric values. A module (`cadEquations`, functions `resolveEquations` and `applyEquationsToModel`) walks the graph and stamps actual numbers into the model so every feature downstream sees settled values, not formulas. This happens once, up front, so no feature reads a stale dial.

### Step 1: Walk the feature tree in order

`cadRegenService.regenerate` processes features top-to-bottom. Order matters: feature five may cut a slot into the solid that features one through four built up; you cannot cut into a solid that does not exist yet. Features that are suppressed or hidden are skipped.

### Step 2: Extract the profile

Most features start from a sketch — a 2D outline. The profile extractor (`cadProfile`, function `extractRegions`) finds the closed loops in the raw sketch geometry: the outer boundary plus any inner loops that form holes. A washer yields one region: large circle outside, small circle inside as the hole. This translation from a pile of sketch lines and arcs into a clean loop hierarchy is the bridge between the messy 2D sketch and the precise instruction the kernel needs.

### Step 3: Check the cache

Before paying the cost of a kernel call, the system checks whether this exact result was computed before. The cache key for each feature is a triple: the feature's identity, a hash of its own parameters, and a hash of everything upstream of it.

The upstream hash is load-bearing. If feature three changes, feature four — which cuts into feature three's solid — gets a new upstream hash and rebuilds even though feature four's own parameters are unchanged. Change something early and everything downstream rebuilds. Change something late and only it and what is below rebuild; everything above is a cache hit. The cache table is `DesignBRepCache`, keyed by this triple.

The cache is explicitly disposable. The `featureTree` is authoritative; the cache is derived and can be rebuilt from scratch by re-running every recipe. It is a speed optimization, never a source of truth.

A `namingVersion` field stamps each cache row. When the kernel's output changes shape — a new face-naming convention, a new pipeline step — the version number is bumped and all old rows stop matching and rebuild. The version history in `cadRegenService` comments is a record of the system's evolution: each bump is a past footgun resolved.

### Step 4: Call the kernel (on a cache miss)

`cadKernelClient` packages the profile and operation as a JSON-RPC request and sends it to the Rust process. The kernel builds a B-rep solid in OCCT and returns: arrays of positions, normals, and indices forming a tessellated mesh, plus per-face metadata.

The per-face metadata is two things. First, a **stable persistent name** that survives a rebuild. When a downstream feature says "fillet the edge between face A and face B," the system must find faces A and B again after re-running the recipe with different parameters — even though the triangles are entirely new. The persistent name is the thread that ties a downstream feature to the geometry it depends on across rebuilds. Naming can break when topology changes drastically (a known footgun across the whole industry), but the attempt to keep names stable is what makes "edit an early feature and watch later features stay attached" possible at all.

Face IDs are **scoped by body**: the kernel may return `f2-f0`; the regen service rewrites it to `f2#0-f0`. When a part has multiple bodies, this scoping prevents face IDs from colliding across bodies. Without it, hiding one body left ghost edges from the other visible in the scene.

Second, a **surface classification** — flat, cylindrical, spherical — used for measurement and mate inference.

### Step 5: Accumulate cumulative bodies

Each feature does not produce an isolated prism. It emits the running, cumulative shape — the new geometry already fused into or cut out of the body that prior features built up. By the bottom of the tree the final solid is ready and the frontend renders only the latest cumulative result.

A feature can optionally start a new body instead of merging into the last one, which is how multi-body parts work. Each result carries a `bodyId`. The viewer renders the set of bodies; operations like "cut with this body" reference `bodyId` directly.

**Output of one full walk:** a set of bodies, each a collection of tessellated faces, each face carrying a stable scoped name and a surface classification.

---

## The Assembly Regeneration Cycle

Assembly regen rhymes with part regen but solves a different problem. Part regen **constructs** — it makes new geometry, and the cost center is the kernel. Assembly regen **arranges** — it positions existing geometry, and the cost center is the mate solver. The kernel is barely touched.

### Step 1: Resolve instances to source geometry

Each component instance in the assembly document points at a specific part (and revision). If that part is released — frozen — its geometry is already computed and stored. The assembly loads the frozen mesh directly. No feature-tree walk, no kernel call, zero recomputation. An assembly of fifty released parts is fifty cheap mesh loads. This is the direct payoff of the freeze/release mechanism.

### Step 2: Solve the mates

Some instances are pinned (fixed in space as the ground reference). Others are floating, positioned only by their relationships. The mate solver takes all the relationships — concentric, coincident, fixed distance, fixed angle — and computes an exact position and orientation (a placement transform) for every floating instance that satisfies all of them simultaneously.

This is a 3D constraint solver: relationships in, a consistent arrangement out. It can fail in the same ways as a 2D sketch solver — over-constrained (contradictory requirements), under-constrained (a part is free to slide) — and must report those failures cleanly.

### Step 3: Transform meshes

Each instance now has a placement matrix. The child part's already-tessellated triangles, defined in the part's own local coordinate space, are pushed through that matrix into the assembly's shared space at the right location and orientation. This is matrix multiplication, not geometry construction. It is cheap and does not touch the kernel.

### Step 4: Re-scope face IDs

Within a single part, a face is identified as `body 0, face 3`. In an assembly, the same part may appear as five separate instances — five copies of the same bolt. They all share the same internal face names. The assembly re-scopes every face ID to `instanceId::bodyId::faceId`. Clicking the third bolt's top face yields a globally unambiguous identifier, enabling correct measurement, mate creation, and selection.

This is the same namespacing instinct as body-scoping within a part, applied one level up.

### Step 5: Compose

All transformed, re-scoped child meshes are bundled into one assembly geometry, plus a **roster** — a per-instance record of which part is placed, where, at what orientation. The roster feeds the bill of materials, the instance tree in the sidebar, and interference checks. The composed geometry is what the viewer draws.

**Contrast summary:** part regen calls the kernel to *make* geometry; assembly regen takes existing geometry and *relocates* it with matrix math. Both converge on the same face-mesh output format, which is why one viewer component can draw a single part or a fifty-piece assembly without modification.

---

## Versioning as the Spine: Working Copy versus Durable History

Two fundamentally different kinds of storage coexist in the system, and confusing them is the source of most versioning bugs.

The **working copy** is the live, editable, current draft. For a part it is the `DesignCADModel` database row; for an assembly it is the `DesignAssembly` row. It is mutable — the thing currently on the workbench. The row carries VCS bookkeeping: which branch it is on, which commit it is based on, whether it is locked for editing, and whether it is "dirty" (changed since the last check-in).

The **durable history** is the content-addressed VCS store — the `VcsObject` and `VcsRef` tables. Every commit there is immutable. It is a permanent, frozen snapshot. History is never edited; only appended to.

The flow: edit the working copy freely, then **check in** — snapshot the working copy and file it permanently as a new commit. The working copy stays editable; the commit is frozen forever.

### The lineage-root repository key

Each part revision in this system is a new `Part` row in the database, linked to the previous one by a `previousRevisionID` pointer. Bracket revision A, B, and C are three rows forming a chain.

Naively, each Part row would own its own VCS repository, and design history would restart from scratch with every manufacturing revision. All continuity — "when did we change this fillet?" — would be lost at each revision boundary.

Instead, the VCS repository is keyed to the **lineage root** — the function `cadVcsService.repoForModel` walks `previousRevisionID` all the way to the very first row in the chain and uses that root's ID as the repository key. Revisions A, B, and C all share one continuous repository. The design story flows unbroken across every manufacturing revision. This is requirement 688 in the system: one repository per part lineage, continuous across revisions.

### Release, freeze, and the three distinct locks

**Release** is the moment floating geometry stops floating and gets nailed to an official revision. It does three things atomically: freezes the geometry (bakes and stores it permanently on that commit so it never has to be recomputed and can never silently change), tags that commit write-once with a revision string (once the tag exists it is locked — cannot be overwritten), and mints a corresponding revision on the manufacturing Part record.

The exact shape the work order says to build is byte-for-byte the shape the designer released. No drifting filenames. No ambiguity about which version is current.

There are three distinct locks that are frequently confused:
- The **edit lock** (checkout lock): a transient PDM-style exclusive lock, like checking a library book out. Someone has this checked out right now; you cannot edit it until they release the lock.
- The **release lock** (`DesignCADModel.releaseLocked`): once a design is released, the working copy goes read-only because it has been frozen. Attempts to update or checkout return HTTP 423.
- The **Part revision lock** (`Parts.revisionLocked`): the manufacturing-side immutability flag on the Part row. Separate concept, separate enforcement.

`main` is the protected, released spine — the official history. Draft work happens on branches. When a branch is ready, releasing it onto `main` advances the official history and mints the new revision. The branch-protection and approval workflow govern who can authorize that release.

---

## "Written Once" — the Shared Machine

Version control, the editor, and the measurement tools are each written exactly one time. CAD parts and assemblies do not get their own copies of this machinery; they plug into it.

The version-control machine exposes four **factories** — functions that take a thin **binding** and hand back fully functional operations:

- `makeWorkingCopy` — the entire checkout/check-in/undo-checkout/lock protocol
- `makeBranchOps` — create, switch, archive, compare branches
- `makeFreeze` — snapshot and store geometry on a commit
- `makeRelease` — freeze, tag write-once, mint a part revision

A **binding** is the small set of answers a document type must provide:
- `repoFor` — what is my repository key?
- `docOf` — how do I extract the savable document from my database row?
- `serialize` / `deserialize` — how do I write/read that document from the object store?
- `applyDoc` — how do I load a document back onto the working copy?
- Regen and freeze hooks: how do I generate my geometry, snapshot it, and reconstruct it from frozen objects?

The CAD binding's `docOf` extracts a feature tree, a sketch document, and equations. The assembly binding's `docOf` extracts an assembly document of instances and mates. The CAD binding's regen hook points at `cadRegenService`. The assembly binding's regen hook points at `assemblyRegenService`. They differ exactly where they must — document shape and geometry derivation — and nowhere else.

Everything downstream — locking, branching, diff, release, the approval workflow — is the shared machine, untouched and unaware of which document type it is serving.

### Three concrete examples of "unaware"

The **workflow engine** drives a design through draft → in-review → approved via a declarative state table. That table is defined once. CAD uses it. Assembly adopts it by pointing at the same table definition. No new workflow code is needed for assemblies. A reviewer clicking "approve" gets identical behavior whether approving a bracket or a gearbox assembly.

The **version-history graph** that renders the branching diagram of commits, tags, and author initials is repo-keyed. Pass it a CAD repository and it draws CAD history. Pass it an assembly repository and it draws assembly history. Same code.

The **structural diff** compares two versions by fingerprint — identical subtrees match by hash and are ignored; only differing subtrees are examined. It knows two vocabularies for labeling changes: "feature" and "sketch" for CAD, "instance" and "mate" for assembly. One diff engine.

There is also **one editor component** on the frontend. It runs a CAD mode and an assembly mode, switched by a route flag. The 3D viewer, the file menu with checkout/check-in/branches/release, and the measurement tools are not duplicated. The assembly mode swaps which geometry source it reads and which side panels it shows, and reuses everything else.

### The honest cost

The factory pattern adds indirection. Understanding check-in requires reading both the generic factory and the binding — two files instead of one. More importantly, the abstraction holds only while CAD and assembly genuinely differ only in those binding questions. Where they do not fit cleanly — reconciling merged branches, for instance, where the right merge behavior genuinely differs between a feature tree and a list of mates — those paths deliberately stay outside the shared factory and live in per-document service code. Knowing what to **leave out** of the shared machine is as important as what to put in. The discipline is not "share everything" but "share the truly common and be explicit about the genuinely different."

---

## Tech-Stack Map

| Layer | Technology | Role |
|---|---|---|
| Frontend framework | Angular 19 with signals | Reactive UI; signals propagate changes from equations through derived state automatically |
| 3D rendering & picking | Three.js | Wraps WebGL; draws kernel-produced meshes; fires raycasts for face picking |
| Backend server | Node.js + Express | HTTP API; hosts regen service; bridges frontend to database and kernel |
| ORM | Sequelize | Translates JavaScript model objects to PostgreSQL SQL |
| Database | PostgreSQL | All durable storage: Part rows, working copies, `VcsObject`/`VcsRef` tables |
| Geometry kernel | Rust + OCCT (C++) | Solid modeling, boolean ops, tessellation, face naming; separate process |
| Kernel protocol | JSON-RPC over TCP | Structured request/response over a socket; isolates kernel crashes from the web server |

The full data path for a single click: the user interacts with an Angular component; Three.js handles the 3D input; the frontend calls an Express API endpoint; Node runs the regen service; the service checks the PostgreSQL cache table; on a miss it sends a JSON-RPC request over a socket to the Rust kernel; the kernel returns tessellated triangles; the service stores them in the cache and hands them to the frontend; Three.js draws them.

Every boundary in that path is deliberate: browser-to-backend is HTTP, backend-to-kernel is a socket, truth-to-derived is the recipe-versus-cache split, working-copy-to-history is check-in. The architecture is a set of well-chosen borders — and "written once" explains why the borders are where they are. Put the genuinely-shared logic on one side of a clean line, put the genuinely-different logic on the other, and the first can be shared without entangling the second.

---

## Key Points

- A parametric CAD model is a feature history — an ordered list of operations with editable parameters — not a static mesh. The shape is derived by replaying the history; the history is the truth.
- Attaching the model directly to the Part database row (rather than a floating file) is the foundational design decision. The inventory record and the geometry share the same identity, revision, and governance.
- Four subsystems with explicit borders: the **modeler** (conductor, browser + `cadRegenService`), the **geometry kernel** (Rust/OCCT, behind a JSON-RPC socket), the **VCS** (content-addressed, `VcsObject`/`VcsRef` in Postgres), and **assemblies** (mate-solver-driven arrangement, itself a Part).
- Part regeneration constructs geometry: resolve equations → walk tree → extract profiles → check `DesignBRepCache` → call kernel on miss → accumulate cumulative bodies. The kernel is the cost center.
- Assembly regeneration arranges existing geometry: resolve instances to frozen meshes → solve mates → transform by placement matrix → re-scope face IDs → compose. The mate solver is the cost center; the kernel is barely touched.
- Face IDs are scoped by body within a part (`f2#0-f0`) and by instance within an assembly (`instanceId::bodyId::faceId`) to prevent collisions and ghost-edge bugs.
- The VCS repository is keyed to the **lineage root** (the first Part row in the revision chain) so design history is continuous across all manufacturing revisions.
- Release simultaneously freezes geometry (permanently stored, never recomputed), tags the commit write-once with a revision string, and mints a revision on the Part record — the moment geometry stops floating.
- Version control, the editor, and measurement tools are each written once as generic factories. CAD and assembly provide thin bindings (document shape + regen hook) and inherit locking, branching, diff, release, and the approval workflow for free.
- The abstraction's honest cost: indirection at read time, and strain wherever the two document types genuinely differ — those paths are deliberately kept outside the shared machine.
