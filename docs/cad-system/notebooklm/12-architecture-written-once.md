# Architecture: Written Once

This document describes the unifying architecture of the browser-based CAD and assembly system: a factory-and-binding pattern that implements checkout, branching, versioning, freezing, and release one time in shared code, then parameterizes it for both single-part CAD models and multi-part assemblies through a small interface. It also covers the shared editor component, the database layout, the API and permission surface, and the hard-won lessons embedded in the design.

## The Binding-and-Factory Pattern

### What "written once" means

The core claim is precise: every operation for managing a design document — checking it out for editing, saving a snapshot, creating a branch, comparing two versions, freezing a released design, walking it through a review workflow — is implemented exactly once in shared code. Both a single-part CAD model and a hundred-part assembly run through the exact same implementation, distinguished by a small object called a *binding*.

A binding is a plain object containing a handful of functions that answer the questions the shared machine cannot answer on its own — because the machine does not know what a CAD feature tree is, and it does not know what an assembly mate is. It knows the verbs. The binding supplies the nouns.

The four shared factories, all in `backend/services/vcs/`, each accept a binding and return a fully wired subsystem:

- **`makeWorkingCopy`** — returns checkout, check-in, undo-checkout, force-unlock, and history-reading operations. This is where the PDM-style exclusive-lock protocol lives: the logic that says "you cannot check this out, Dana has it," lock expiry, and the 423 HTTP response code (resource locked). All of it is document-agnostic.
- **`makeBranchOps`** — returns create-branch, list-branches, switch-branch, and archive-branch operations. Branch switching reads the target branch's head commit, calls the binding's `deserialize` to reconstruct the document, and calls `applyDoc` to restore it onto the working-copy row. It also sets `releaseLocked` to true when switching to the branch named `main`, because `main` is the protected released line. That "main is protected and read-only" rule lives in the shared factory; both document types inherit it automatically.
- **`makeFreeze`** — on release, calls the binding's `regen` to build geometry, stores a mesh snapshot blob plus one binary BRep object per body, and records a manifest. The function `geometryForCommit` checks whether a commit has frozen geometry stamped on it; if so, it reconstructs the shape from frozen pieces via the binding's `reconstruct` with zero kernel calls. A released part never re-runs the Rust geometry engine on open — the geometry is the exact bytes that were reviewed and approved.
- **`makeRelease`** — implements a careful ordering that exists because the naive ordering caused a real bug (see the footguns section): check for a duplicate tag first, then serialize, then freeze geometry, then claim the write-once tag, then advance the branch. Mutation comes last.

### The binding contract

The binding interface has nine fields. In spirit, they answer five questions: who am I, what is my document, how do I store and restore it, and how do I rebuild my geometry.

- `noun` — the string `"model"` or `"assembly"`, used so error messages read "this assembly is checked out" rather than "this model."
- `repoFor(model)` — given a working-copy database row, return the repository identity for this document. For both document types this walks the part's `previousRevisionID` chain to the lineage-root part id, ensuring one continuous history across all revisions of a part.
- `docOf(model)` — reach into the database row and extract the serializable document. For CAD, this returns `{ featureTree, sketchDoc, equations }` — the recipe, the 2D sketches, and the parametric equations. For assembly, it returns `{ assemblyDoc }` — a single blob containing component instances and mates.
- `serialize(doc, repoId)` — turn the document into content-addressed objects and return a root tree hash. The CAD serializer (`cadSerializer.js`) writes one blob per feature, one blob per sketch, one blob for equations, and a meta blob recording feature order, then bundles them into a tree. The assembly serializer (`assemblySerializer.js`) writes one blob per component instance, one blob per mate, and a meta blob. The shapes are parallel: one blob per feature, one blob per instance. That granularity is load-bearing — it makes per-feature diff and per-feature cherry-pick possible, and means editing one feature re-writes only that blob while the rest share their unchanged hash.
- `deserialize(hash, repoId)` — given a tree hash, read back a document.
- `applyDoc(model, doc)` — given a document read back from storage, produce the database patch that restores it onto the working-copy row.
- `commitMeta()` — any extra metadata to stamp on every commit (e.g., kernel version, naming version).
- `regen(model)` — rebuild 3D geometry. Called by the freeze machine on release.
- `snapshot(model)` — produce a lightweight mesh fingerprint with no heavy BRep data, for use in thumbnails and history previews.
- `reconstruct(frozenPieces)` — given frozen geometry blobs from storage, rebuild renderable geometry without calling the kernel.

### The machine never looks inside the document

The shared machine never inspects document content. When it needs to store a document, it calls `binding.serialize(doc)` and receives a single hash. Whether that hash represents three blobs (CAD) or one blob (assembly) is invisible to the machine. This discipline — the machine sees only hashes, the binding owns the content structure — is what makes the abstraction hold.

### Document-agnostic services above the factories

Three more services ride on top of the object store without factory parameterization:

**Workflow engine.** The review lifecycle — draft, in-review, approved — is a declarative engine. A `WORKFLOWS` table in code maps document types to transition tables, and the assembly entry simply points at the CAD workflow definition. Assemblies adopt the full review lifecycle by sharing one line. The engine checks actor permissions (submitting requires `cad.write`, approving requires `cad.approve`), advances state, and fires a notification. If the notification fails, the transition still succeeds; a flaky email does not block an approval.

**Version history graph builder.** This builds the branching commit-tree picture visible in the history UI. It is keyed by repo identity alone and draws the graph for a CAD or assembly repository with identical code.

**Diff engine.** The core diff function, `treeDiff`, compares two commit trees purely by entry hash. If two subtrees share a hash they are identical — skip them. The algorithm runs in time proportional to what changed, not the size of the whole model, because equal hashes guarantee equal content. The only document-aware code is a label formatter at the end: entries starting with `feature:` become "Feature so-and-so," `instance:` entries become "Component so-and-so," `mate:` entries become "such-and-such mate." That label lookup is the entire assembly-awareness in the diff engine.

## The Shared Editor

There is one editor component: `cad-editor.component.ts`. The assembly editor and the CAD editor are the same Angular component class. They are distinguished by a single reactive signal called `assemblyMode`, which is set from the route on load.

When `assemblyMode` is true, the component injects an assembly controller and assembly service and swaps two things: the source of the geometry it displays, and which panels appear in the ribbon toolbar. Everything else is shared without modification:

- The 3D viewer (`cad-viewer`) — rendering, orbit controls, lighting, selection highlighting.
- The measurement tools — distance, angle, radius.
- The entire version-control surface: the "File" ribbon tab containing checkout, check-in, branches, workflow buttons, release, compare, and merge. Every button in this tab calls whichever API endpoint the active mode points to. In CAD mode they call `/api/design/cad-model/...`; in assembly mode they call `/api/design/assembly/...`. Same buttons, same layout, same behavior, different address.

The route wiring is almost comically small. The route for `parts/:id/cad/editor` loads `CadEditorComponent`. The route for `parts/:id/assembly/editor` also loads `CadEditorComponent` — the same class — with one extra piece of route data: `assemblyMode: true`. One boolean on a route is the entire fork between the two products on the frontend.

The honest cost of this choice: the editor is the largest, busiest component in the frontend, and it grows whenever either product grows. The `assemblyMode` flag threads through more of the shell than is ideal. The tradeoff is that the complexity is concentrated in one known place rather than smeared across two parallel components that would silently drift. The shared viewer, shared File tab, and shared measurement stack are clean seams that barely know which mode they're in. The editor shell that wires them together is where complexity pools.

Landing pages — the "CAD Models" list and the "Assemblies" list — are genuinely two small separate components, because they list different things. The moment a user clicks into editing, they enter the shared editor.

## The Data Model

The database tables divide into three jobs: the desk (what you're working on now), the filing cabinet (the immutable object store and its references), and the logbook (audit trails and support tables).

### The desk: working copies

Two tables hold the live editable working copies. `DesignCADModel` is the open CAD document. `DesignAssembly` is the open assembly document.

Both tables carry an identical block of version-control columns:

- `branchName` — which version line the working copy is on, defaulting to `main`.
- `baseCommitHash` — the sixty-four-character SHA-256 hash of the commit it was checked out from.
- `dirty` — a boolean indicating unsaved edits exist.
- `lockedByUserID`, `lockedAt`, `lockExpiresAt` — the PDM checkout lock: who holds it and until when.
- `defaultView` — a saved camera angle, stored as a user preference, not versioned content.
- `releaseLocked` — a boolean marking the working copy read-only after a release.

The difference between the two working-copy tables is only in the document columns. `DesignCADModel` has three JSONB columns: `featureTree`, `sketchDoc`, `equations`. `DesignAssembly` has one JSONB column: `assemblyDoc`. That is the entire schema-level difference between the two document types.

One active working copy per part is enforced by a partial unique index (e.g., `design_cad_models_part_unique_active`) that applies only where `activeFlag = true`. Soft-deleting an old working copy and creating a new one does not conflict, because the deleted row is no longer active. Revisions of a part are not extra rows in these tables — they are tags in version control.

### The filing cabinet: VcsObject and VcsRef

`VcsObject` is the heart of the version-control system. Every feature blob, every tree, every commit, every chunk of frozen geometry, every component reference, and every thumbnail is one row in this table. The primary key is a triple: `repoType`, `repoId`, and `hash`.

- `repoType` is `cad` or `assembly` — a namespace preventing CAD and assembly objects from colliding even when they belong to the same physical part.
- `repoId` is the lineage-root part id. The `repoFor` binding function walks the `previousRevisionID` chain from the current Part row back to the original part in the lineage. Every revision of a part shares one repository, giving one continuous version history across the part's entire manufacturing life.
- `hash` is the SHA-256 fingerprint of the object's content. Two objects with identical content produce the same hash and collapse to one row. Writing the same content twice is idempotent — no error, no duplicate row.

The table has no `updatedAt` column. Objects are written once and are immutable forever. That immutability is what makes the hash trustworthy.

Six kinds of object exist:

- `blob` — a leaf node: one feature, one sketch, one mate, one component-instance record.
- `tree` — an ordered list of named pointers to children, e.g., `feature:abc → <hash>`.
- `commit` — wraps a tree with parent hashes, author, message, timestamp, and a metadata bag (kernel version, naming version). These three kinds compose the git-like DAG.
- `geometry` — binary: the frozen BRep bytes from the geometry kernel, one body per object, stored in the `bytes` column.
- `component` — an assembly-specific kind that references another repository's commit, encoding "this assembly used revision X of this child part."
- `thumbnail` — a small PNG snapshot captured on check-in for display in history views.

`VcsRef` holds named pointers to commits. A branch ref is mutable — `main` advances on every check-in. A tag ref is write-once — `release 01` or a production letter like `A` is set at release and never moved. Write-once enforcement on tags is implemented in the service layer, not via a database constraint: the update-ref function checks whether an existing ref is a tag and refuses to move it. Every path through the system that modifies refs goes through `vcsService`.

### The logbook: audit, workflow, and support tables

`DesignCADModelHistory` and `DesignAssemblyHistory` are append-only audit logs. Every meaningful administrative action — created, updated, checked out, checked in, released — writes a row recording who, when, and the before and after state. This is the human-facing paper trail that answers "who released this and when." It is separate from the VCS commit history, which is the geometry trail. A checkout does not create a VCS commit (nothing about the geometry changed) but it absolutely creates an audit row (someone took the lock). Different granularity, different question.

`VcsWorkflowState` records the review state — draft, in-review, or approved — one row per workflow scope. Its `repoId` is composed as `<lineageRootPartId>:<branchName>`, making workflow state per-branch. Part 42 on `main` and part 42 on `draft/01` have independent review states. Two draft branches can be in review simultaneously; `main` keeps its own production-approval cycle. Absence of a row means the initial state, draft — a brand-new model starts in draft with zero database writes.

`VcsChangeset` is a reserved placeholder for bundling commits across repositories in one atomic operation — the "I edited a part and the assembly that contains it in one save" scenario. The table and model exist; nothing writes to it yet. It was wired in early because adding new structures to a content-addressed store is painful to migrate. Its status is honestly labeled: reserved, empty.

`VcsUsage` is a where-used reverse index. When an assembly commit references a child part's commit, a row records the relationship. The question "which assemblies use this part?" becomes one indexed lookup instead of scanning every assembly commit ever made. The object store holds the forward edge; `VcsUsage` holds the reverse edge.

`DesignBRepCache` is a performance cache for draft editing, CAD only. When a model regenerates, each feature's computed 3D output is cached keyed by four values: the model id, the feature id, a hash of the feature's parameters, and a hash of all upstream geometry feeding into it. Editing a feature near the top of a twenty-feature model invalidates only the downstream features; everything above the edit is a cache hit loaded with zero kernel calls. This cache is disposable — deleting every row loses nothing, and the next regeneration rebuilds it. Durable released geometry lives as immutable `geometry`-kind objects in `VcsObject`. A `namingVersion` column on the cache ensures that when face-naming conventions change, old cache rows are ignored automatically.

## The API Surface and the One Permission Resource

### Route structure

The API exposes two parallel address books: `/api/design/cad-model/` and `/api/design/assembly/`. Both are auto-discovered and mounted by `backend/api/index.js`, which scans the API folder tree and mounts any subdirectory containing a `routes.js` file. The same shared VCS verb set appears at both addresses: checkout, check-in, undo-checkout, force-unlock, commit listing, the history graph, branch CRUD, workflow transitions, release, production-release, diff, and reconcile. These are identical because they call the same shared factories.

Each side then adds verbs unique to its document type. The assembly side adds: insert-instance, update-instance, add-mate, remove-mate, patterns, exploded views, display states, interference checking, mass properties, and BOM sync. The CAD side adds: cherry-pick, rebase, working-diff, set-default-view, and regenerate-from-recipe. The shared spine is the VCS vocabulary; the domain-specific arms differ because a part and an assembly genuinely do different things.

### One permission resource, four actions

Every CAD and assembly route is protected by two middlewares: `checkToken` (valid session) and `checkPermission` (resource and action). The resource for every route on both address books is the same string: `cad`. There is no separate `assembly` permission resource.

This decision is both conceptually correct and practically convenient. Design work is design work; an organization that trusts a user to edit parts trusts them to edit assemblies. Splitting the permission would create a false distinction. The practical benefit: reusing `cad` for assemblies added zero new permissions to the system, which meant the test that asserts an exact total permission count did not need to be touched or re-justified.

The four actions:

- `read` — all GET operations: listings, history, exports, diffs, graph.
- `write` — create, edit, checkout, check-in, branch operations, mate editing, and development release (the self-service numeric release that any designer can trigger).
- `delete` — soft-delete a model, remove an instance or mate.
- `approve` — force-unlock and production release (the letter-revision release gated on the full review workflow reaching approved state).

The workflow transition route is an intentional exception to the pattern. Because a single endpoint handles all transitions — submit, approve, reject, reopen — a static `checkPermission` middleware cannot specify the right action, since different transitions require different actions. The route is mounted with `cad.read` as a minimum gate; the actual per-transition permission check (`cad.write` for submit, `cad.approve` for approve) is enforced inside the workflow engine, which is the only place that knows which transition is being attempted.

Frontend routes are guarded by a login guard and a `cad` permission guard, mirroring the backend. Granting `cad.read` and `cad.write` to designers and `cad.approve` to reviewers configures access for the entire CAD-and-assembly world in one step.

## Hard-Won Lessons and Footguns

### Test cleanup table ordering

Tables with foreign keys to `Part` or `User` using `onDelete: RESTRICT` must appear at the top of the `tablesToClean` array in the test setup file, before `Parts` and `Users`. `DesignCADModelHistory`, `DesignAssembly`, and similar tables must be cleaned first. Violating this order produces a restrict-violation error in an unrelated test's teardown that costs significant debugging time. Every new table with a Part or User FK on restrict goes at the top of the cleanup list.

### Unique display names in multi-user tests

`Users.displayName` is a unique column. The `authenticatedRequest` test helper defaults to "Test User." Any test that needs two users — most obviously, a checkout-conflict test ("Dana has it checked out, can Sam check it out?") — must give the second user a distinct display name. The failure mode is a database uniqueness error that has nothing to do with what is under test, and it is most likely to appear in exactly the lock-contention scenarios this system is built to handle.

### Permission count test

A test asserts the exact total number of permissions in the system as a guard against accidental additions or removals. Every new permission resource adds actions that force a count change, a test edit, and a justification. When assemblies were added, reusing the existing `cad` resource meant zero new permissions and zero test churn. When the conceptually clean answer (design is one job, one resource) and the pragmatically easy answer (no count bump) agree, trust them both.

### Assembly fixture category: name, not id

To test assemblies, a fixture part needs to belong to the "Assembly" category. In the test fixture seeding, that category happens to have id 4. Hardcoding `categoryId: 4` in a fixture couples the test to an accident of seeding order. The production code resolves eligibility by category *name*, not id. Tests should match the production contract: think in terms of the category named "Assembly," not a magic number that happens to be correct today.

### Check before mutate: the release ordering bug

The original `makeRelease` implementation did what felt natural: create the release commit, advance the `main` branch to point at it, then check whether the release tag already existed. If it did, it threw a write-once error. But by then, `main` had already moved. A double-click, a retried request, or a race left an orphan duplicate release commit and `main` pointing past the actually-tagged commit. The history graph showed an untagged commit as HEAD while the released badge sat on a buried ancestor.

The fix is a strict ordering rule: check for the duplicate tag first, before touching anything. Then serialize and freeze the geometry. Then claim the write-once tag. Then advance the branch. The irreversible step — moving the branch — is last. And claiming the tag before advancing the branch means that even in a true concurrent race, the worst case is a harmless unreachable commit object, not a corrupted branch pointer. What looks like deliberate elegance in `makeRelease` is a scar written into the code from a real incident.

## Reflection: When "Write It Once" Pays Off

The factory-and-binding pattern succeeds here because there is a clean, nameable seam between the shared machine and the document-specific logic. The differences between CAD and assembly — how a document is serialized, deserialized, restored, regenerated, and frozen — fit cleanly through the binding interface without leaking into the shared factories. When differences fit through a defined interface, sharing is a genuine win: half the code, no drift between implementations, a feature added to the shared machine appears in both products immediately.

The pattern becomes a trap when applied before the seam is visible. If the assembly had been imagined and the factories built speculatively for a second product that did not yet exist, the interface would have been a guess. Real requirements would have arrived bent to fit a vacuum-invented interface. That is premature abstraction.

The reason this case avoided that trap: CAD was built first, completely, as a single concrete system with no abstraction. The factories did not exist — there was just "the CAD VCS." Only when assembly arrived as a real second requirement, with real mates and real instances, did the existing CAD code get examined for what actually needed to differ. The answer was small and clean. The factories were extracted from working code, with the seam visible and validated by a second real case. The rule: two concrete cases before generalizing. One is a guess. Two is a seam.

Two honest limitations remain. First, the shared editor shell (`cad-editor.component.ts`) is the largest, busiest component in the frontend and it grows whenever either product grows. The backend seam is clean; the frontend seam is good but under tension. The `assemblyMode` flag threads through more of the shell than is ideal. A sharper version would keep the shell thin — a frame hosting a viewer, a File tab, and a ribbon — and push more mode-specific behavior into the injected services and swapped panels. Sharing the editor is the right call; keeping it honest is an ongoing subscription, not a one-time fee. If the `assemblyMode` branches multiply without discipline, the shared-ness becomes fiction.

Second, `VcsChangeset` — the empty reserved table — sits on a thin line between "wisely pre-wired" and "speculative cruft." Content-addressed stores are painful to migrate, so wiring in the seam early was defensible. But an empty table implies something to a reader. Its status as a reserved schema seam is documented; the honest tension is real.

The final score: the backend shared architecture is as clean a "written once" as the system's author has shipped, proven by the fact that assembly features land without touching assembly-specific VCS code, because there is almost none. The frontend is genuinely shared, with the editor shell as the place the abstraction is under the most strain.

## Key Points

- **Four shared factories parameterize the entire version-control system.** `makeWorkingCopy`, `makeBranchOps`, `makeFreeze`, and `makeRelease` each accept a binding and return a complete subsystem. Checkout, branching, freeze, release, and the review workflow are implemented once.
- **A binding is nine functions and a noun.** The binding contract — `repoFor`, `docOf`, `serialize`, `deserialize`, `applyDoc`, `commitMeta`, `regen`, `snapshot`, `reconstruct`, plus `noun` — is the entire interface separating the shared machine from document-specific logic. CAD and assembly each supply a binding of roughly two hundred lines.
- **The shared machine never inspects document content.** It works with hashes. Whether a hash represents a three-field CAD document or a one-field assembly document is sealed inside the binding's serializer, invisible to the factories.
- **One Angular component serves both editors.** `cad-editor.component.ts` is both the CAD editor and the assembly editor, distinguished by an `assemblyMode` signal set from the route. The entire fork between the two products on the frontend is one boolean on a route definition.
- **Both working-copy tables carry an identical block of VCS columns.** The schema difference between `DesignCADModel` and `DesignAssembly` is only the document content columns — three JSONB columns versus one. The version-control machinery columns are byte-for-byte identical.
- **`VcsObject` is the immutable core.** Every blob, tree, commit, geometry, component reference, and thumbnail is one row, keyed by `(repoType, repoId, hash)`. Objects are write-once and have no `updatedAt`. Each part's entire revision lineage shares one repository via the lineage-root id.
- **One permission resource covers both products.** Every CAD and assembly route uses the resource string `cad` with four actions: `read`, `write`, `delete`, `approve`. No separate assembly permission exists. Write gates development release; approve gates production release and force-unlock.
- **The release ordering must check before mutating.** The `makeRelease` function verifies no duplicate tag exists before creating any commit or moving any branch. This ordering was learned from a real bug where advancing the branch before checking the tag left a corrupted-looking history. The irreversible step is always last.
- **Abstract from two concrete cases, not one.** The factories were extracted from working CAD code only when assembly arrived as a real second requirement. Building the abstraction speculatively for an imagined second product would have produced an interface designed for a guess. Two real cases reveal the actual seam; one is speculation.
- **`DesignBRepCache` is disposable scratch; frozen geometry in `VcsObject` is the durable record.** The cache accelerates draft editing by storing per-feature regen results keyed on parameter and upstream-geometry hashes. Deleting it loses nothing. Released geometry is frozen as immutable `geometry`-kind objects in the object store.
