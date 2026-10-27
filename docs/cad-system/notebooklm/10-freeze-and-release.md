# Freezing Geometry and Releasing Revisions

This document explains how a browser-based parametric CAD system converts a mutable draft design into a permanently frozen, manufacturable revision — and why that distinction is a correctness requirement, not an optimization. It covers geometry freezing, commit thumbnails, the review workflow engine, two release tiers, three interlocking locks, release exports, and the lineage-continuity principle that keeps all of this in one unbroken history.

## Why a Recipe Is Not Enough

A draft part in this system is a recipe: an ordered list of features — sketch a rectangle, extrude it ten millimeters, cut a hole, fillet an edge. Every time a draft is opened, the kernel re-runs the recipe from scratch and produces the 3D body. Nothing is stored between sessions. This is correct for a draft: any edit to a dimension immediately produces a fresh shape, and there is no stale cache to get out of sync.

The problem appears the moment a design ships. A geometry kernel is software, and software changes. When the OCCT library underneath the kernel is upgraded, or a bug in fillet blending is fixed, the same recipe evaluated through the newer kernel can produce a slightly different shape. Usually the difference is submicron — a tessellation a hair finer, a blend a rounding-error different. "Usually invisible" is not "guaranteed identical," and for a controlled revision of a medical-device component, "usually invisible" is unacceptable.

The concern is concrete. A shipped revision is a physical thing. Barcodes, work orders, and a bill of materials all point to "revision A of this bracket." If revision A's geometry can drift — if opening it next year through a newer kernel gives a subtly different shape than the one that was actually machined — the documentation no longer matches the steel. The revision number on the drawing is supposed to mean one exact shape, forever.

Additionally, the computed BRep (boundary representation — the mathematical description of the solid) is cached but evictable. The system can discard it to save space and recompute on demand, which is correct for drafts. But a released revision sitting on top of both an evictable cache and a moving kernel is not reproducible. REQ 684 states this directly: "the BRep cache is evictable and the kernel changes between versions, so a released revision is not otherwise reproducible." The solution is to capture the answer once — at the moment of release — and store that answer permanently, alongside the recipe but independent of it.

A draft trusts the recipe because it wants to track live changes. A release distrusts the recipe because it must never change. That inversion is the governing principle of the freeze system.

## What Freeze Captures

Freeze operates per body. A body is one solid lump of material; a part may contain several. For each body, freeze stores two artifacts.

**Artifact one: the BRep.** The boundary representation is the exact mathematical description of the solid — every surface, every edge, every vertex, the precise curves stitched into a watertight solid. This is the form OCCT works in, the form you would machine from, and the form that feeds a STEP export. It is stored as raw binary bytes via `putBinary` in the content-addressed object store.

**Artifact two: the mesh.** The BRep is exact but a web browser cannot draw it directly. A triangle mesh — the shape approximated as a bag of flat triangles, with positions, indices, face groupings, and persistent face names — is what the 3D viewer actually renders. By storing the mesh at freeze time, opening a release reads the exact triangles captured on release day. No re-tessellation happens, and no kernel is called.

Both artifacts go into the same content-addressed store used for all VCS objects (blobs, trees, commits). Freezing is not a separate storage mechanism; it is the same warehouse. The same deduplication properties follow: if two revisions share a body that did not change, the BRep bytes are identical, hash to the same fingerprint, and are stored exactly once. The freeze of a barely-changed part is almost entirely no-op writes.

## The Mesh Snapshot and What It Excludes

The mesh artifact is produced by a function called `meshSnapshot` in `cadFreezeService.js`. The function is ruthless about what it includes, because the snapshot must be content-stable: the same geometry must always produce byte-identical output.

`meshSnapshot` keeps: each feature's id, body id, face data (positions, indices, persistent names), topology, and any error; the body list with ids and names; and the errors list.

It strips two categories of data. First, BRep strings — those go to separate binary objects, one per body, so they can dedup and be fetched independently. Second, per-feature cache flags: bookkeeping booleans that record whether a given feature was served from cache during the regen that produced this snapshot. Those flags depend on runtime state, not geometry. If a cache flag were left inside the snapshot, the same shape computed twice — once fresh, once from cache — would produce two different hashes, breaking deduplication. The exclusion list follows the same discipline as the canonical-JSON serializer described elsewhere: strip every source of nondeterminism before fingerprinting.

The result of `freezeGeometry` is a small manifest: `{ meshHash, bodies: [{ bodyId, brepHash }, ...] }`. This manifest is the index into frozen storage. It says "the frozen mesh is at fingerprint X, and the frozen BReps are at fingerprints Y, Z, one per body." That manifest goes into the release commit's metadata as `meta.frozen`. The presence of `meta.frozen` is the single flag that distinguishes a release commit from a draft commit.

## Loading Frozen Geometry Without the Kernel

Frozen geometry is reconstructed by `loadFrozenGeometry` in `cadFreezeService.js`. Given a repo and the `frozen` manifest from a commit, it does exactly two reads and one glue step.

Read one: fetch the mesh blob by its `meshHash`. This is a content-addressed lookup — fingerprint in, bytes out. The result is the mesh snapshot: the bag of triangles and face metadata.

Read two: for each body in the manifest, fetch its BRep bytes by `brepHash`. One content-addressed lookup per body.

Glue: call the domain-supplied `reconstruct` callback, which takes the snapshot and a map of body-id to BRep bytes, walks the snapshot's body list, and re-attaches each body's BRep by matching `body.id`. The result is the full renderable geometry — mesh and BReps — exactly as it was at freeze time. REQ 685 requires zero kernel calls on this path.

The entire machinery is assembled by a factory function, `makeFreeze` in `vcsFreeze.js`. The factory is domain-agnostic; it knows nothing about CAD. CAD binds it by supplying three callbacks: `regen` (call the kernel via `cadRegenService.regenerateModel`), `snapshot` (produce the content-stable mesh via `meshSnapshot`), and `reconstruct` (re-attach BReps to a loaded snapshot). Assembly supplies its own three callbacks. The factory wires them into the actual storage operations once; each domain gets correct freeze/load behavior by supplying its callbacks.

The `loadFrozenGeometry` path also sets a `frozen: true` flag on the reconstructed geometry, so downstream consumers — the viewer, an exporter — can confirm that the geometry came from frozen storage rather than a live regen.

### The Dispatcher

The single branch point between "load from storage" and "run the kernel" lives in one function: `geometryForCommit`. It takes a commit, reads `meta.frozen`, and routes: if the field is present, call `loadFrozenGeometry`; if absent, call `regen` live. Every consumer — the 3D viewer, the diff service, the exporter — goes through `geometryForCommit`, so the "frozen loads, draft regens" guarantee applies everywhere without any consumer reasoning about it. The version-history diff that compares two release commits calls zero kernel operations because both commits carry `meta.frozen`; `geometryForCommit` loads both from storage.

## Commit Thumbnails

Every commit carries a small thumbnail image, separate from the full frozen mesh. The thumbnail is what appears instantly in the version-history list (REQ 710), so browsing history does not require loading a full 3D scene for every row. When a user opens a 3D commit preview, the thumbnail appears immediately as a placeholder while the interactive mesh loads behind it, then swaps out when ready (REQ 711).

**Primary path — client PNG.** At check-in, the browser is already rendering the model in the viewer. It captures a low-resolution PNG of the viewport at the model's default view angle and ships it to the server. The server stores it via `storeThumbnail` in `cadVcsService.js` as a `thumbnail` binary object. Thumbnails are the one object kind in the VCS store that are not content-addressed: two commits with identical geometry still get different thumbnail keys, because the key is derived from the commit identity, not the pixel content. The key is `sha256("thumb:" + commitHash)`, which produces a 64-character hex string fitting the `VcsObject.hash` varchar(64) column. (Using `"thumb-" + commitHash` directly would overflow the column — the column width forced the key design.)

**Backfill path — server-side SVG.** For commits created before client thumbnail capture was introduced, a backfill script (`backfill-cad-thumbnails.js`) generates server-side SVG images using `renderGeometrySvg` in `cadThumbnailSvg.js`. This function implements a painter's algorithm — sorting faces back-to-front and painting them as flat-shaded polygons — to produce a static isometric image without a raster library. The SVG path is explicitly a one-time catch-up tool. If a commit has no thumbnail at runtime, the controller returns 404; it does not fall back to live SVG rendering. A runtime fallback would be unpredictable server-side compute on the read path, contrary to the precompute-and-store philosophy that governs the entire system.

## The Workflow Engine

The review workflow is a generic, declarative state machine in `workflowEngine.js`. It knows about states, transitions, and permissions; it knows nothing about sketches, BReps, or CAD models. The principle matches the rest of the system: write the machinery once, bind it per domain.

### States and Transitions

The CAD workflow (`CAD_WORKFLOW`) has three states:

- **Draft** — being actively worked on.
- **In review** — submitted for evaluation.
- **Approved** — signed off.

Transitions:

| From | Action | To | Permission required |
|---|---|---|---|
| Draft | submit | In review | `cad.write` |
| In review | approve | Approved | `cad.approve` |
| In review | reject | Draft | `cad.approve` |
| Approved | reopen | Draft | `cad.write` |

The separation between `cad.write` and `cad.approve` is the entire point of the workflow in a regulated shop. The person who draws the part cannot be the person who signs it off — that is a bedrock separation-of-duties principle in quality systems. Submit requires only write access; approve requires a distinct elevated permission. If both were the same permission, a designer could approve their own work, defeating the purpose of review.

### Permission Checks in the Engine

The permission check lives inside the `transition` function in the engine, not solely in the API route handler. Even a code path that bypasses the usual route and calls the engine directly cannot approve without `cad.approve`. The guard is at the bottom, not bolted on at the surface. The rule travels with the engine.

The `transition` function proceeds in four steps, and the order is deliberate: (1) find a matching transition in the table from the current state — if none exists, 409 ("that move doesn't make sense from where you are"); (2) check the caller's permission — if missing, 403 ("you specifically can't make this move"); (3) advance the state; (4) fire a notification, best-effort.

### Best-Effort Notifications

Notifications are fired inside a try-catch, and a throwing notifier is swallowed. The state change is the truth; the notification is a courtesy. REQ 706 requires that a throwing notification hook does not cause the transition to fail. This prevents coupling a hard state change to a flaky external channel — a push token expiring should not silently prevent an approval from being recorded.

### Per-Branch Workflow State

Workflow state is stored in `VcsWorkflowState` keyed by a (type, id) pair. The key is an opaque string from the engine's perspective — it never parses it. The CAD controller composes the key as `<lineageRoot>:<branchName>`, using a helper called `workflowRepo`. So `568:draft/01` and `568:draft/02` are two independent keys, even though they refer to the same part lineage. Three concurrent draft branches can each be at a different review stage. Main keeps its own production-approval cycle on its own `568:main` key. This was achieved with zero schema changes because the id column was already free-form text; the branch name was simply embedded in the string.

### Reuse Across Document Types

A `WORKFLOWS` map binds document types to workflow definitions. Currently both `cad` and `assembly` point at the same `CAD_WORKFLOW` definition and the same `cad` permission resource. Adding a new reviewable document type — requirements, harnesses — requires only a new entry in that map. No engine code changes. That extensibility is the rationale for REQ 703: a reusable declarative engine that can "later govern parts/harness/requirements by adding a transition table."

## The Release-Ordering Footgun and the Fix

The most consequential bug in the release system arose at the seam between freeze and release. Releasing a revision requires three operations on shared state: create the release commit (carrying frozen geometry), place a write-once tag naming the revision, and advance the `main` branch reference to the new commit. Tags are write-once — `createTag` throws if a tag of that name already exists.

The original release code performed these in the wrong order: create commit, advance `main`, then place the tag. A double-click, a network retry, or a race between two concurrent requests could result in the following: the second attempt creates a duplicate commit and advances `main` to point at it — *before* hitting the tag check and throwing 409. At that point, `main` points at an untagged duplicate commit. The actual released-and-tagged commit is buried as an ancestor. The visible history shows the wrong object as head; the released badge sits on a buried commit; `model.baseCommitHash` diverges from the `main` ref. A genuine corruption, requiring surgical repair — resetting the `main` VcsRef back to the tagged commit.

The fix is a general principle: do the thing that can fail before the thing that mutates shared state. The corrected sequence in `makeRelease` (`vcsRelease.js`) is: (1) check tag absence up front — if the tag already exists, refuse immediately with 409, nothing touched; (2) freeze geometry; (3) create the commit; (4) create the write-once tag; (5) advance `main`. Creating the tag *before* advancing `main` ensures that a race between two releases leaves at most a harmless orphan commit — a commit no ref points to, invisible in history, garbage-collectable later. The loser cannot advance `main` because it throws at step 4, before reaching step 5. Garbage is ignorable; corruption requires repair.

## Release Tier One: A Draft Branch Becomes a Number

The first release tier is self-service. Any user with `cad.write` — the basic CAD editing permission — can release a draft branch onto `main`. This produces the next numeric revision (`01`, `02`, `03`). It is an engineering checkpoint, not a formal externally-controlled release.

The function is `releaseBranchToMain` in the CAD controller. It enforces two gates before proceeding.

**Gate one: the branch must be checked in (REQ 715).** The `dirty` flag must be false and a base commit must exist. Releasing uncommitted work is refused — check in first.

**Gate two: the branch must not be behind main.** If `main` advanced past the point where the branch started — meaning main has commits the branch does not include — the branch is "behind," and releasing it would clobber work already shipped. Release is blocked until the branch is reconciled with main via the feature-level merge described in the version-control documentation.

Once both gates pass, the release mints a number. The function calls `partRevisionService.createNewRevision`, which looks up the highest released numeric revision for the part lineage, increments it, and creates an actual new `Parts` row with the zero-padded result (`01`, `02`). This is the moment a floating derived number becomes a concrete database row. (Draft branches display a derived draft revision — the highest released number plus one — which floats correctly across all concurrent drafts. Release crystallizes one floating number into a real row, and all remaining drafts' derived numbers immediately bump.)

The release then calls the factory: `cadVcsService.release` wraps `makeRelease`. This freezes geometry (regen once, store mesh and BRep blobs, build the manifest), creates the release commit with `meta.frozen` set, places the write-once tag named for the numeric revision, and advances `main` — in the fixed order, tag before advance.

The new commit's parent is set to the draft branch's own head, not to the previous `main` head. This preserves the full development history — every incremental check-in made on the branch — as genuine ancestors of `main`, git-style (REQ 746). For a regulated design history, the sequence of intermediate check-ins is the traceability record; squashing that history into a single flat commit loses the thread of how a decision evolved.

After the release commit lands, three things are locked: `DesignCADModel.releaseLocked` is set to true, `Parts.revisionLocked` is set on the parts row, and the draft branch reference is deleted (archived). Deleting the ref removes only the pointer; the commits survive as ancestors of `main`. The branch as a workspace is retired; the work is permanently preserved.

## The Three Locks in Detail

Three independent locking mechanisms protect different things, and they return different HTTP status codes.

**Lock one: `lockedByUserID` — the checkout lock.**
This is a transient, concurrency lock. When a user checks out a part to edit, their user id is written to `lockedByUserID` with a thirty-minute expiry. It means "this user is actively editing; nobody else gets a pencil right now." Violating it returns **423 Locked**, identifying the current holder. Main itself is always locked for edit — `isLockedForEdit` returns true whenever `branchName === 'main'`, independent of `releaseLocked` — also reported as 423.

The lock's lifecycle respects unsaved work and never bothers an active editor. Every content save slides the expiry forward; the editor heartbeats a renew while its tab is visible; and the attributed holder can *revive* an expired lock (intact attribution proves nobody claimed it — the case where a laptop slept through the TTL). When a lock does expire, the background sweep clears it only if the working copy is *clean*; an expired lock over dirty, uncommitted edits keeps its holder attribution, and a second user must perform an explicit takeover — which first stashes the abandoned edits onto a `stash/` branch authored by the original holder before resetting the working copy. A check-in can also be made as a *checkpoint* (`keepCheckedOut`), committing a milestone while renewing rather than releasing the lock. An administrator can always force-release.

**Lock two: `DesignCADModel.releaseLocked` — the CAD design lock.**
This is permanent. Once a design is dev-released, `releaseLocked` is set to true and the `DesignCADModel` is read-only forever. "Forever" is not "until the lock expires" — the design is done. Editing it would undermine the point of a frozen release. Hitting this lock returns **409 Conflict**, signaling "what you're asking conflicts with the state of the world — this design is released."

**Lock three: `Parts.revisionLocked` — the manufacturing lock.**
This lives on the parts table, not the CAD design, and it is manufacturing's own immutability flag — the signal that BOMs, barcodes, and work orders depend on this revision being fixed. It predates the CAD module and applies to all inventory parts. Dev release sets both `releaseLocked` and `Parts.revisionLocked` simultaneously: the design is frozen, and the manufacturing revision is locked. Also returns **409**.

The mapping: 423 means "wait, someone is working" or "this is the protected main line." 409 means "this is frozen, you need a new revision." Different kinds of refusal, different codes.

**Escape hatch: new revision.** A released design cannot be edited. To make changes to a shipped part, the `newRevision` function mints the next numeric revision via `partRevisionService`, creates a fresh, unlocked `DesignCADModel` that copies the feature tree, sketches, equations, and default view forward, and preserves the lineage repo so history is continuous (REQ 720). If a user attempts to check out a locked, released revision, the system performs this copy automatically rather than simply refusing, and opens the new revision for editing (REQ 730). The lock is a fork in the road, not a dead end.

## Release Tier Two: The Production Letter Revision

The second release tier is approval-gated. It requires the `cad.approve` permission and the workflow state must be `approved`. This is where the review workflow from the previous section clicks in. The function is `productionRelease`.

It mints a **letter** revision — `A`, `B`, `C` — via `partRevisionService.releaseToProduction`, which produces the next letter in a sequence that skips six characters: `I` (looks like `1`), `O` (looks like `0`), `Q` (looks like `O`), `S` (looks like `5`), `X` (ambiguous or reserved), and `Z` (looks like `2`). After `Y`, the sequence continues `AA`, `AB`. The exclusions exist because revision letters appear on engineering drawings and stamped parts, where a human may be reading off a smudged print or a laser-etched plate in poor light. The confusable letters are deliberately absent. The sequence is defined in `partRevisionService.REV_LETTERS`.

The critical property of a production release: **it does not re-freeze.** It does not call the kernel. It does not regenerate the shape. What `productionRelease` does is take the existing dev release commit — already frozen, already carrying `meta.frozen`, its geometry already stored — and place a new write-once tag, the letter `A`, on that same commit.

The result: the numeric tag (e.g., `02`) and the letter tag (e.g., `A`) both point at the identical commit object. Same tree, same `meta.frozen`, same mesh blob, same BRep bytes. The claim "the shipped production part is geometrically identical to the approved dev release" is not a guarantee checked at runtime — it is impossible to violate by construction, because it reduces to pointer equality on one immutable, content-addressed commit. Two labels, one frozen photograph.

The entire freeze-and-content-address apparatus exists so that this — the most important guarantee in a regulated release process — is trivially, mechanically true.

All of this runs inside a database transaction: mint the letter revision, create the new `DesignCADModel` row whose base commit is the dev release commit, `createTag` the letter. If any step fails, the whole thing rolls back cleanly. After success, the workflow state is reset to draft, so the next round of changes starts a fresh review cycle.

## Exports from Frozen Geometry

Exporting a released revision to STL or STEP does not recompute the geometry. The export function (`exportRelease`) resolves the write-once revision tag to the commit it points at, finds `meta.frozen` in that commit, and calls `geometryForCommit` — the dispatcher that, seeing a frozen commit, loads the BReps from frozen storage rather than regenerating. Zero kernel calls to obtain the geometry.

The kernel is then called, but only as a serializer. `exportBodyBreps` hands the already-frozen, already-final BRep bytes to the kernel and asks it to write STL or STEP format. For STL: OCCT's `exportStl` operation (tessellate-and-write). For STEP: `exportStep`. The kernel is not recomputing the shape — the shape is fixed in the frozen bytes. The kernel is performing a format conversion on geometry that is already decided.

The distinction matters: the geometry (the actual solid shape) is never recomputed for a release, ever. The kernel's involvement at export is limited to transcoding stored bytes into a file format. Because the BReps come from the frozen tag, the exported file is identical today, next year, and after any number of kernel upgrades. If the kernel is unavailable when an export is requested, the transcoding fails with 503, but the frozen geometry remains fully intact in storage; the viewer continues to show the part correctly.

## Lineage Continuity Across All Revisions

A part accumulates multiple kinds of revision records: numeric dev releases (`01`, `02`), new-revision forward copies, and production letter releases (`A`, `B`). These are all commits or tags in a single, unbroken DAG.

The glue is the lineage-root key. The VCS repo for a part is keyed not to the current `DesignCADModel` database row but to the lineage-root part: `repoForModel` walks `previousRevisionID` links back to the original part row and uses that id as the repo id (REQ 724). Every `DesignCADModel` for every revision of the same part — regardless of how many `Parts` rows manufacturing has cut — resolves to the same repo.

This matters because release is precisely the moment new `Parts` rows are minted. Every dev release creates a row; every production release creates a row. If the repo were keyed to the row, release itself would fragment the history on every cut. Because the repo follows the platonic part rather than the database rows, the full sequence — `01`, `02`, `A`, `03`, `B` — appears as one connected commit graph, browsable in a single history view. The lineage-root decision and the release machinery are made for each other.

## Key Points

- A released part is a photograph, not a recipe. At release, the geometry is computed once, frozen per-body as exact BRep bytes plus a renderable triangle mesh, stored in the content-addressed VCS object store, and indexed by a manifest in `meta.frozen` on the release commit. Opening or exporting a release reads those bytes; the kernel never runs.
- The `meta.frozen` field on a commit is the single dispatcher flag. `geometryForCommit` routes to `loadFrozenGeometry` (storage reads, zero kernel) if the field is set, or to live `regen` if absent. Every consumer — viewer, diff, exporter — goes through this one function.
- Frozen geometry deduplicts across revisions for free. A body unchanged between two releases shares its frozen BRep object via content-addressing; the second freeze is a no-op write.
- The workflow engine (`workflowEngine.js`) is domain-agnostic. Submit requires `cad.write`; approve requires `cad.approve` — encoding separation of duties into the engine itself. State is keyed per branch (`<lineageRoot>:<branchName>`) so concurrent drafts review independently with no schema change.
- Notifications from workflow transitions are best-effort. A throwing notifier is swallowed; the state change always commits. A flaky push service cannot prevent an approval from being recorded.
- The release-ordering footgun: the original code advanced `main` before placing the write-once tag, so a double-click could march `main` past the real release before the 409 was thrown. Fix: check tag absence first, create tag before advancing `main`. A race now leaves a harmless unreachable orphan commit, never a corrupted `main`.
- Two release tiers: numeric dev releases are self-service (`cad.write`), freeze and tag the commit, preserve branch history as ancestors of `main`. Production letter releases are approval-gated (`cad.approve` + workflow `approved`) and add a second write-once tag to the *same* frozen commit — making "production geometry = approved dev geometry" a pointer-equality guarantee, not a checked property.
- Three locks: checkout lock (`lockedByUserID`, transient, 423), CAD design lock (`releaseLocked`, permanent, 409), manufacturing revision lock (`Parts.revisionLocked`, permanent, 409). The escape from the design lock is `newRevision`, which copies the design forward into a new editable working copy while preserving lineage.
- The checkout lock's expiry never destroys work: saves slide the expiry, expired-but-dirty locks survive the background sweep, and taking over an abandoned dirty checkout first stashes the prior holder's edits onto a `stash/` branch under their name. Checkpoint check-ins (`keepCheckedOut`) commit a milestone without surrendering the lock.
- Revision letters skip I, O, Q, S, X, and Z to avoid legibility confusion on engineering drawings and stamped parts.
- All revisions of a part — dev numerics, copies, production letters — live in one commit DAG keyed to the lineage-root part id. Release mints rows freely without fragmenting history, because the repo follows the platonic part, not the database rows.
