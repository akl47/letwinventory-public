# cadBranchService — CAD Branch Operations

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Branches](../branches.md) ▸ **cadBranchService**
> Related: [vcsBranchOps](./vcsBranchOps.md) · [cadVcsService](./cadVcsService.md) · [cadDiffService](./cadDiffService.md) · [merge-reconcile](../merge-reconcile.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 692 | unapproved | Create a named variant branch |
| 694 | unapproved | Switch working copy to another branch |
| 695 | unapproved | Archive a branch (current and main protected) |
| 696 | unapproved | Cherry-pick a single feature from a source commit |
| 697 | unapproved | No automatic merge; cherry-pick is the only cross-branch reconciliation |
| 734 | unapproved | Protected main branch — no direct editing |
| 738 | unapproved | Flag branch as behind-main when main has advanced |
| 741 | unapproved | Feature-level merge (reconciliation) of main into a behind-main branch |
| 747 | unapproved | Merge tool lists every feature AND sketch that differs between main and branch |

### REQ 741 — Feature-level merge (reconcile)

- **Description:** The CAD history shall provide a feature-level merge (reconciliation) of main into a behind-main branch: starting from main's current document, splice in the selected branch features (add/replace with their referenced sketches; a selected id absent from the branch = a branch deletion). The result is committed onto the branch with `parents=[mainHead]`.
- **Rationale:** When main has advanced, the branch needs a way to incorporate main's changes selectively without losing its own work. An automatic whole-tree merge is unreliable for parametric feature trees; explicit per-feature selection is predictable.
- **Verification:** Integration test: reconcile applies selected branch features onto main's latest doc and commits with main's head as parent.
- **Validation:** An engineer can incorporate main's latest changes into their branch while keeping their own features intact.

---

## Succinct description

CAD-specific branch operations: wires `vcsBranchOps` for the four shared operations (create/list/switch/archive), then adds cherry-pick, behind-main detection, rebase, and the feature-level merge (`reconcileBranch`) that is unique to parametric CAD documents.

## How it works — for everyone (non-technical)

While the generic machinery handles creating, listing, switching, and archiving branches, CAD designs need additional abilities: copying one feature from another branch (cherry-pick), checking whether a branch has fallen behind the main released line, and merging main's latest changes in a controlled way — choosing exactly which features to bring over. This module provides all four.

## How it works — in detail (technical)

`backend/services/vcs/cadBranchService.js` exports the `vcsBranchOps` four plus these CAD-specific operations:

### `cherryPick(model, sourceCommit, featureId, userId, db)`

Reads the source commit's doc, finds `feature:<featureId>`, splices it into the working copy (replacing by id, or appending if new), and copies all referenced sketches (`referencedSketchIds` scans `sketchId`, `sketchIds`, and any field matching `/sketchId$/i`). Sets `dirty = true`. No commit is created — the user must check in separately.

### `behindMain(model, db) → boolean`

Walks the branch's ancestry set and returns `true` if `main`'s current head hash is NOT in it. Never true when the working copy is already on `main`.

### `rebaseBranch(model, userId, {at}, db)`

Creates a new commit with the branch's current tree but with `parents = [mainHead]`, then advances the branch ref to that commit. Last-writer-wins on the document content — the branch's own doc is kept as-is, it just acquires main as its parent. Rejected while dirty or when already up to date.

### `reconcileBranch(model, sel, userId, {at}, db)` and `mergedReconcileDoc`

The supported 3-way reconciliation (REQ 741). `sel` may be `{ featureIds, sketchIds }` or a bare array (back-compat for `featureIds` only).

`mergedReconcileDoc` builds the merged document without committing:
1. Deserialize main's current doc (`baseDoc`) and the branch's current doc (`branchDoc`).
2. Clone `baseDoc` as the starting point.
3. For each selected `featureId`: if the branch has it → add/replace in the base; if the branch doesn't have it (deletion) → remove from the base.
4. For each selected `sketchId`: if the branch has it → replace; if not → delete.
5. Return `{ featureTree, sketchDoc, equations, repo, branchName, mainHead }`.

`reconcileBranch` calls `mergedReconcileDoc`, serializes the result, creates a commit with `parents = [mainHead]`, advances the branch, and updates the working copy.

`mergedReconcileDoc` is also exported for the live 3D preview (the editor can render the would-be reconciled state before committing).

```mermaid
flowchart LR
    MAIN["main head\n(latest released doc)"] -->|deserialize| BD["baseDoc"]
    BRANCH["branch head\n(current draft doc)"] -->|deserialize| BR["branchDoc"]
    BD & BR -->|feature-level splice| MERGED["merged doc\n(main + selected branch changes)"]
    MERGED -->|serialize + commit\nparents=[mainHead]| NC["new commit\non branch"]
```

### `referencedSketchIds(feature)`

Utility used by both `cherryPick` and `reconcileBranch`: collects sketch IDs from `feature.sketchId`, `feature.sketchIds[]`, and any field whose name matches `/sketchId$/i`.

## Key files

- `backend/services/vcs/cadBranchService.js` — all exports
- `backend/services/vcs/vcsBranchOps.js` — `makeBranchOps` (create/list/switch/archive)
- `backend/services/vcs/cadVcsService.js` — `repoForModel`, `cadVersionInfo`
- `backend/services/vcs/cadSerializer.js` — `cadDeserialize`, `cadSerialize`
