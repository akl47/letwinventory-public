# Content-Addressed Version Control

The CAD system's version control is a purpose-built, content-addressed object store modeled directly on git's core primitives: blobs, trees, commits, and named refs. Every piece of design history — individual features, sketches, equations, and snapshots — is fingerprinted by its own content and stored once. There is no "current version" column anywhere in the database. The current state is a pointer; the history is the database itself. This document covers how the object store works, how CAD documents are serialized into it, how checkout and branching operate, how diffs are computed, how merge is (deliberately) refused in favor of surgical reconciliation, and where the design is honest about its footguns and reserved seams.


## The Object Store — There Is No Save

The implementation lives in `backend/services/vcs/vcsService.js`, and by design it knows nothing about CAD. It knows nothing about sketches, extrudes, parts, or features. It is a generic, domain-blind object store implementing exactly four git primitives. This was deliberate: the hard machinery — content addressing, commit DAG, ref management — is written once and then bound separately to the CAD domain in one set of files (`cadVcsService.js`) and to the assembly domain in another (`assemblyVcsService.js`). When assemblies arrived as the second domain, the store itself did not change — the domain-blindness paid off exactly as designed.

The backing tables are `VcsObjects` (columns: `hash`, `content`, `bytes`) and `VcsRefs`. `VcsObjects` holds every piece of immutable stored data; `VcsRefs` holds the mutable pointers.

A **repo** is the scope for all objects and refs. It is identified by a type (`cad`, `assembly`) and an id — but not the id of the current database row for the part. Because manufacturing cuts new `Parts` rows whenever a revision is released, the VCS scopes to the *lineage root*: the id of the original `Parts` row, found by walking the `previousRevisionID` chain all the way back (with a cycle guard). This is implemented in `cadVcsService.js` as `repoForModel`. The entire design history across all manufacturing revisions of a real-world part lives in one continuous, unbroken repo keyed to the original row — not to any one revision.


## Content Addressing — The Fingerprint

Every object stored in `VcsObjects` is identified by a SHA-256 hash of its own contents. This is the central mechanism, and it has three consequences that arise simultaneously from the same fact:

**Deduplication.** Two things with identical contents produce an identical hash. The store writes only one copy. If a forty-feature part is saved and only one feature changed, only that one feature produces a new hash. The other thirty-nine hash to values already in the store — the write is a no-op for each of them. Storage cost scales with what changed, not with model size.

**Immutability.** An object's hash is computed from its contents. If the contents change, the hash changes — so it becomes a different object at a different address. The old object is still in the store at its old hash, untouched. Immutability is not enforced by permissions or triggers; it is enforced by arithmetic. The store never overwrites.

**Tamper-evidence.** Any modification to stored bytes produces a different hash, which the reader can detect by recomputing. This is the regulatory backbone: a released commit and the write-once tag pointing to it cannot be quietly altered.

To prevent hash collisions between different object kinds, `hashJson` prepends the kind name as a string prefix before hashing — `"blob "`, `"tree "`, `"commit "` — so a blob and a tree with identical payloads produce different hashes. `hashBinary` handles raw bytes (frozen geometry) and takes the same prefix approach.


## Canonical JSON — The Linchpin

Content addressing requires that equal-in-meaning always produces equal-in-bytes. Without this, two identically structured CAD features serialized in different property-insertion orders would hash differently, breaking deduplication and making diff useless.

The solution is `canonicalJson.js`, 62 lines, a single exported function `canonicalJson`. It is called in exactly two places inside `vcsService.js`, deep in hashing and the low-level put. Callers never touch it directly — it is invisible plumbing. Its rules:

- **Sort object keys alphabetically**, recursively. Property insertion order is erased. `{a:1,b:2}` and `{b:2,a:1}` produce identical bytes.
- **Arrays are left ordered.** In a CAD feature tree, the order of features is semantic — extrude-then-fillet differs from fillet-then-extrude.
- **Non-finite numbers throw.** `NaN`, `Infinity`, and `-Infinity` would all serialize to `null` under standard `JSON.stringify`, causing different values to collide on one hash. Canonical JSON throws instead, surfacing the upstream error loudly rather than silently corrupting an address.
- **Negative zero collapses to zero.** JavaScript's `−0` and `+0` are distinct in the language but mathematically equal; canonical JSON normalizes them.
- **BigInt throws.** BigInt cannot round-trip through JSON without precision loss; lossy serialization cannot be trusted as canonical.

Every rule closes either the "two meanings, one hash" door or the "two serializations, two hashes" door. Both directions must hold or the whole edifice collapses.


## Object Kinds — Blobs, Trees, Commits, and Extensions

The model enforces a fixed list of kinds. Three are foundational:

**Blob.** The smallest meaningful unit — one feature, or one sketch. A blob contains only the raw content of that one item; it carries no name, no position, no context. It is anonymous content at a fingerprint address.

**Tree.** An ordered list of entries, each with three fields: a name (e.g. `feature:f7`, `sketch:s3`, `equations`, `meta`), a kind, and a fingerprint. The tree does not contain its children — it *points* at them by fingerprint. Because the tree is itself content, it has its own fingerprint computed from its entries. Editing one feature changes that feature's fingerprint, which changes its entry in the tree, which changes the tree's fingerprint. The change ripples up exactly one path; everything else is shared.

**Commit.** The dated snapshot. It points at exactly one tree and carries metadata: author, message, timestamp, version, and — critically — the fingerprint(s) of its parent commit(s). The parents are part of the commit's content, folded into its hash, making the entire chain tamper-evident. Rewriting a parent produces a different commit hash, so the chain is structurally self-verifying. The caller supplies the timestamp (not the commit function itself), so the hash is reproducible: given the same inputs, including the same timestamp, you get the same commit fingerprint.

Three extension kinds:

**Geometry.** Binary, stored via `putBinary` (hashing raw bytes). When a part is released, its computed 3D solid-body data from the kernel is frozen here. Zero kernel calls are needed to re-read a released commit's shape.

**Component.** An object that references another repo's commit, so a snapshot can record exactly which state of another document it depends on. This seam, originally reserved for assemblies, is now load-bearing twice over: an assembly check-in pins the commit of each child part it was assembled from, and a part that borrows cross-part in-context reference geometry pins the source part's commit the same way. Each pin also writes a `VcsUsage` row — a where-used reverse index, so "which assemblies use this part?" is one indexed lookup instead of a scan.

**Thumbnail.** A PNG preview captured at check-in. Deliberately *not* content-addressed: it is keyed per commit, because the access pattern is "give me the thumbnail for commit X," not "give me this exact image." An explicit, intentional exception to the content-addressing rule.


## Serializing a CAD Document Into the Tree

`cadSerializer.js` is the only CAD-aware code anywhere near the object store. Two functions — `cadSerialize` and `cadDeserialize` — form the membrane between a CAD document and a git tree.

A CAD document is three things: the `featureTree` (ordered list of features), the `sketchDoc` (sketches keyed by id), and `equations` (parametric variables). `cadSerialize` walks this and writes one blob per item:

- Each feature in the feature tree becomes a blob named `feature:<id>`.
- Each sketch becomes a blob named `sketch:<id>`, keys sorted for determinism.
- The equations object becomes a blob named `equations`.
- A `meta` blob records the feature *order* (the ordered list of feature ids), because the tree sorts entries alphabetically by name and cannot preserve sequence. Meta also holds sequence counters and other top-level bookkeeping.

The test for serialization is blunt: `cadDeserialize(cadSerialize(doc))` must deep-equal the original document with zero loss.

The granularity — one blob per feature, not one blob for the whole model — is what makes storage, diff, and cherry-pick all cheap. Saving a model after editing one feature stores two new objects (the changed feature blob and the updated tree); the other thirty-nine feature blobs are deduplicated away.


## Refs — Mutable Branches and Write-Once Tags

`VcsRefs` is the only mutable thing in the system. A ref is a name, a kind, and the fingerprint of a commit. There are two kinds:

**Branch.** A mutable pointer. When a new commit is made, the branch sticky note moves from the old commit to the new one. The commits never change; only the label advances. The "current version" of a part is: follow the branch ref → that commit → its tree → its blobs. Four hops to reconstruct any version.

**Tag.** Write-once. `createTag` throws an error if a tag of that name already exists; there is no update path. Tags mark releases. When revision `01` or revision `A` is cut, a write-once tag is placed on the exact commit. Because the tag cannot move and the commit is content-addressed, the regulatory guarantee is structural: revision `A` is this geometry, byte for byte, forever. The claim is not "we won't change it" but "we can't."

Deleting a ref via `deleteRef` removes only the sticky note. Every commit, tree, and blob that ref pointed at remains in the store at its fingerprint. If those objects are reachable from another ref, they are fully alive. If they are not, they become unreachable dead weight — never visible in history, never harmful. Objects are never deleted.


## Working Copy — Checkout, Lock, Autosave, Check-in, Undo

The working copy is a `DesignCADModel` database row — the live, mutable document open on the user's desk. The commits in the store are the permanent snapshots filed in the archive. The operations that move material between them are written once in a factory called `makeWorkingCopy` in `vcsWorkingCopy.js`, domain-blind, with adapters provided by `cadVcsService.js` for parts and `assemblyVcsService.js` for assemblies.

**Checkout** acquires an exclusive PDM-style lock on the branch: a `lockedByUserID`, `lockedAt`, and `lockExpiresAt` stamp (default 30 minutes, configurable). While the lock is held, any other user who attempts checkout receives HTTP 423 with the current holder's name in the error. Three release paths exist: the holder can release, time can release (the lock expires), or an admin can force-release (requires the approve permission). Active work extends the lock automatically — every content save slides `lockExpiresAt` forward, and an explicit renew endpoint lets an idle-but-present editor keep its claim.

Expiry interacts with unsaved work carefully. A background sweep, `sweepExpiredLocks`, bulk-clears stale locks — but only on *clean* working copies. An expired lock on a *dirty* copy keeps its holder attribution, because someone's uncommitted work is at stake. A second user checking out over an expired-dirty lock gets a 409 requiring an explicit takeover; the takeover first **stashes** the abandoned work — commits it onto a dedicated `stash/<branch>/<timestamp>` branch authored by the prior holder — and only then resets the working copy to the branch head. Nobody's work is ever silently destroyed by a lock expiring; it is parked on a branch with the right author's name on it. A save attempted against an already-expired lock is rejected with 423 rather than quietly succeeding under someone else's takeover.

**Autosave** persists edits to the working-copy row continuously and sets a `dirty` flag, stamping `lastContentSavedAt` on genuine content changes (renames and camera-view saves do not count). It does not create a commit. Its job is preventing data loss; it is not a history mechanism. The editor uses the `lastContentSavedAt` age to warn about *stale dirty work* — a checkout sitting uncommitted past a four-hour threshold gets a visible nudge to check in.

**Check-in** is the deliberate milestone action. It requires holding the lock and supplying a commit message. It serializes the working document via `cadSerialize`, creates a commit whose parent is the current branch head, advances the branch ref to the new commit, and clears the dirty flag. A `keepCheckedOut` option makes the check-in a *checkpoint*: the commit lands and the lock is renewed rather than released, for the long session that wants durable milestones without surrendering the branch.

**Undo checkout** discards all changes since the last check-in. It clears the lock and dirty flag, then — if a commit exists to roll back to — deserializes that commit's tree and writes it back over the working copy. If no commit exists (brand-new part, never checked in), it simply unlocks. The last good state is an immutable commit, so restoration is trivially safe.

History is clean because autosave and check-in are separate mechanisms: only named, deliberate milestones appear as commits.


## Branches and Protected Main

At the storage level, a branch is a mutable ref. The workflow built on branches is opinionated.

**`main` is protected.** `isLockedForEdit` (in the controller) returns true whenever the working copy's `branchName === 'main'`, independently of any other state. Checkout, check-in, and edits on main are rejected with HTTP 423. Main advances only through the formal release flow. This is not convention; it is enforced in code at the data layer.

**Auto-seeding a draft branch.** When a CAD model is created, `createForPart` calls `cadVcsService.seedMain` (an initial empty commit on main) and immediately auto-creates and switches to `draft/01`. The user lands on an editable draft from the very first second and never touches main directly. `seedMain` is idempotent: if the lineage repo already has a main ref, it uses it.

**Derived draft revision.** A draft branch's displayed revision number is not stored anywhere. `derivedDraftRev` computes it at request time: the highest released numeric revision that exists in the `Parts` table for this lineage, plus one. This avoids the unique-constraint collision that would occur if every draft branch minted a real `Parts` row (two concurrent drafts would both try to claim the same next revision number). Instead, all concurrent drafts show the same derived number. Whoever releases first claims the real row; the derived number for everyone else automatically bumps because the max in the table moved. The parts table is the oracle; the VCS derives from it.

**Branch operations** are assembled by `makeBranchOps` in `vcsBranchOps.js`: create, list, switch, and archive. Switch refuses while the working copy is dirty (HTTP 409) because switching replaces the editable state with another branch's document, and uncommitted changes would be silently lost. Archive refuses on main and on the current branch. `switchBranch` sets `releaseLocked = true` mechanically when landing on main, enforcing read-only at the data level rather than re-checking branch name on every subsequent request.

**Globally random feature and sketch ids** (not sequential) prevent merge conflicts. Sequential ids would cause features created on independent branches to collide ("feature 4" on branch A and "feature 4" on branch B are different features). Random global ids ensure identity is unique regardless of branch. The only exception is `f1`, the origin feature, a fixed shared seed that every part starts with.

**Behind-main detection.** `behindMain` walks the branch's ancestry (the set of commits reachable by traversing parent links backward) and checks whether main's current head commit appears in that set. If main's tip is in the ancestry, the branch is up to date. If it is not, main advanced somewhere the branch has not incorporated, and release is blocked until reconciliation.


## Diff — Comparing Two Snapshots

Per-feature granularity pays its second dividend in diff performance. The core is `treeDiff` in `cadDiffService.js`. Given two trees (two tables of contents), it lines them up by entry name and compares fingerprints. For each named entry, four cases apply: present only in the older tree (removed), present only in the newer tree (added), present in both with different fingerprints (modified), present in both with the same fingerprint (unchanged). The unchanged case requires no deserialization — equal fingerprint means equal content, so the entry is skipped immediately. Diff cost scales with the number of things that changed, not with model size. A forty-feature model where two features changed is a two-item diff, computed by comparing forty fingerprints, thirty-eight of which match instantly.

**`attachEntryDetail`** handles the second pass. For features flagged as modified, it deserializes both versions and computes a `paramDiff`: field-level old-to-new deltas ("Distance: 10 → 25", "Direction flipped"). It resolves a human-readable display name (the feature's own name if set, otherwise a type label like "Extrude" or "Cut-Extrude").

**`sketchDiff`** diffs sketch internals. It indexes every entity (line, arc, circle) by id and every constraint by id, classifying each as added, removed, or modified. Constraint values are included, so a dimension edit reads as "distance d1: 10 → 25" — not "the sketch is different." A `meta` sub-diff catches name and visibility changes.

**`workingDiff`** diffs the live working copy against the commit it was checked out from. It serializes the current document to a tree (without committing) and runs the same `treeDiff` against the base commit. This powers the check-in dialog: the user sees exactly what they are about to snapshot before writing the commit message.

**3D and face-level diff.** `bodyDiff3D` regenerates the 3D shape for both commits (loading frozen geometry when available, running the kernel only for unfrozen drafts) and classifies each solid body as added, removed, modified, or unchanged, where "modified" is determined by hashing the body's mesh data. `faceNameDiff` returns the set of persistent face names for each commit so the viewer can color added faces green and removed faces red. Persistent naming (assigned by the kernel) gives each face a stable identity across edits, so a face that moved because a part was made taller reads as unchanged, while a genuinely new face gets a new name and lights up green. The color diff tracks identity, not raw position.

A shared helper, `regenCommitGeometry`, short-circuits kernel calls for frozen commits: it loads geometry directly from the stored binary objects. Diffing two released revisions touches the kernel zero times.


## Merge — The Deliberate Refusal and the Surgical Alternative

There is no automatic merge. The system deliberately will not auto-combine two branches' design trees. The reason is structural: a parametric CAD model is a dependency graph, not text. Feature 7 depends on the sketch from feature 3, which depends on the datum from feature 1. Blindly interleaving features from two branches can produce a model that references geometry no longer present — one that looks syntactically valid but regenerates into garbage. Auto-merging a feature tree is a promise that cannot be kept, so the system refuses to make it.

Two tools handle branch integration instead:

**Cherry-pick** (in `cadBranchService.js`) splices one specific feature from another branch's commit into the current working copy. A helper, `referencedSketchIds`, scans the feature for any field whose name ends in `sketchId` (or contains `sketchIds`) and automatically includes the referenced sketches. Cherry-pick is atomic at the feature-plus-dependencies level. It marks the working copy dirty; the user reviews and checks in.

**Feature-level reconcile** (`reconcileBranch`, built on `mergedReconcileDoc`) handles the common case where a draft branch has fallen behind main. The direction matters: it starts from main's current document — the freshest released state — and splices the user's *selected* changes on top. It does not start from the draft and try to layer main in, because that risks the draft's stale versions of shared features overwriting main's newer ones. The reconcile tool presents every feature and sketch that differs between main and the branch — added, removed, or changed — and pre-selects all of them. The user can untick any item to keep main's version. The result is committed onto the draft branch with main's head as the parent commit, which makes main's tip part of the branch's ancestry — `behindMain` flips to false, and release is unblocked. A 3D preview of the merged document is rendered before the commit is made.

An older `rebaseBranch` function (whole-tree last-writer-wins) still exists in `cadBranchService.js` but is superseded in the UI by the feature-level merge.


## History Graph

`cadGraphService.js`, function `buildGraph`, assembles the entire history in one shot, ready to render with no further database round-trips.

The algorithm: (1) List every branch ref. Walk each branch's ancestry backward using the `walk` primitive (breadth-first over parent links, deduplicating shared ancestors). Union all reachable commits into one map so shared trunk commits appear exactly once. (2) Assign visual lanes: commits reachable from main get the `main` lane; commits reachable only from a draft branch take that branch's lane and are rendered as "experiment." (3) Index tags by the commit they point at; a tagged commit gets a `released` state badge. (4) Batch-fetch all distinct author users in one query and attach names and initials (e.g. "AL"). (5) Assemble each commit into a graph node carrying: full hash and 4-character short prefix, parent hashes (for the front end to draw DAG edges), message, timestamp, lane, branch, release tags, whether it is HEAD, author, and released-or-draft state. Sort newest-first.

The front end (`cad-revision-list.component.ts`) renders four views: **Graph** (visual family tree with thumbnail previews), **Diff** (pick any two commits, get structural diff with green/red face coloring and two 3D previews side by side; a camera-lock toggle synchronizes rotation across both views), **Log** (plain commit table), and **Branches** (management: list, create, open, merge, archive).

**Open version** loads any past commit full-screen in the editor as a read-only snapshot. It calls `getCommitDoc`, which takes a commit hash, deserializes the tree via `cadDeserialize`, and ships the feature tree, sketches, and equations to the editor with editing tools disabled. It does not touch the working copy or current branch. Mechanically it is the standard four-hop read path — ref → commit → tree → blobs — applied to a historical commit. Once a content-addressed commit graph exists, read-only time-travel is not a feature that needs to be built; it follows automatically from uniform addressability.


## Footguns and Honest Limits

**The tag-before-branch-advance bug.** The original release flow advanced the `main` ref first and then checked whether the write-once tag already existed. On a double-click or race condition, the error fired after main had already moved: an orphaned duplicate commit was left as the new head of main, the actually-tagged commit was buried in history, and the working copy's `baseCommitHash` diverged from where main actually pointed. The fix reorders: check for the tag's existence up front, then `createTag` before `updateBranch`. A race now leaves, at worst, a harmless unreachable commit object — never corrupted visible history. The principle: do the operation that can fail (write-once tag check) before the operation that mutates shared state (advancing main). Validate, then commit.

**Dedup bookkeeping in reconcile.** Splicing selected features from a branch into a main-base document requires tracking which features have already been applied, so a feature present in both main and the branch is not added twice. This is the standard off-by-one bookkeeping problem any tree-merge code encounters; the implementation handles it with explicit "seen" tracking.

**Seams that graduated, and one still reserved.** The `component` object kind and the `VcsUsage` where-used index — originally scaffolded for a future assembly editor — are now in active use: assembly check-ins pin child-part commits, cross-part in-context references pin their source-part commits, and every pin writes a usage edge. The `VcsChangeset` table — for atomic multi-document check-ins ("I edited a part and the assembly that contains it in one save") — remains wired but empty. The store was built domain-blind specifically so these seams could exist without structural change; two of the three are now load-bearing.

The git core — objects, trees, commits, refs, canonical hashing, working copy, checkout/lock/check-in/undo, branches, diff, feature-level merge, history graph — is fully implemented, tested, and serving both parts and assemblies.


## Key Points

- There is no "current version" column. The `VcsObjects` table is the history; the current state is a mutable `VcsRefs` pointer (a branch sticky note) to a content-addressed commit.
- SHA-256 content addressing provides deduplication, immutability, and tamper-evidence simultaneously from one mechanism. Objects are addressed by what they contain, not by an assigned id.
- `canonicalJson.js` (62 lines) is the load-bearing linchpin: it sorts object keys, rejects non-finite numbers, collapses `-0`, and throws on BigInt, ensuring equal-in-meaning always produces equal-in-bytes.
- Per-feature granularity — one blob per feature, one blob per sketch — pays off in three places: storage cost scales with changes, diff skips unchanged entries by fingerprint comparison alone, and cherry-pick can splice a single feature across branches.
- The repo id is the *lineage root* part id, found by walking `previousRevisionID` to its origin. All manufacturing revisions of the same physical part share one continuous VCS history.
- `main` is protected by code (`isLockedForEdit` returns true for `branchName === 'main'`), never by convention. Draft branch revision numbers are derived from the parts table at request time, avoiding unique-constraint collisions between concurrent drafts.
- There is no automatic merge. `reconcileBranch` starts from main's current document and splices user-selected features on top, producing a commit whose parent is main's head, clearing the behind-main flag. A 3D preview is rendered before committing.
- Write-once tags are the regulatory backbone: `createTag` throws if the name exists; the tag cannot be moved; the commit it points at is immutable. Revision A is those bytes, forever, structurally.
- The tag-before-branch-advance ordering bug: always check and create the write-once tag before advancing the branch ref. A failed tag check after main moves leaves corrupted history; a failed tag check before leaves only an unreachable object.
