# Merge & Reconcile

> **System** ▸ [Overview](../00-overview.md) ▸ [VCS](../30-vcs.md) ▸ **Merge & reconcile**
> Related: [VCS subsystem map](./00-overview.md) · [Branches](./branches.md) · [Diff & compare](./diff-compare.md) · [History graph](./history-graph.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 696 | unapproved | Cherry-pick a single feature from a source commit into the working copy |
| 697 | unapproved | No automatic merge; cherry-pick is the only cross-branch reconciliation primitive |
| 741 | unapproved | Feature-level merge of main into a behind-main branch (selected features + sketches) |
| 747 | unapproved | Merge tool lists every differing feature AND sketch, pre-selected, with per-item opt-out |

### REQ 696 — Cherry-pick

- **Description:** The system shall cherry-pick a single feature from a source commit into the working copy — splicing that feature and the sketches it references into the working copy and marking it dirty — without performing any merge.
- **Rationale:** Cherry-pick is the only reconciliation between branches; it lets a user pull one improvement from a variant into another line without merging entire histories.
- **Verification:** Integration test: cherry-pick a feature from a source commit splices feature + referenced sketches into the working copy, dirty=true.
- **Validation:** A user can copy one feature from one branch into another.

### REQ 741 — Feature-level merge of main into a behind-main branch

- **Description:** The CAD history shall provide a feature-level merge (reconciliation) of main into a behind-main branch: starting from main's current features, the user selects which features from the branch to apply (added/changed features are spliced in with their sketches; selected deletions are removed). The result is committed onto the branch with main's head as parent, so the branch carries main's latest plus the chosen branch changes. Automatic whole-tree merging is not performed.
- **Rationale:** Branching from an old node leaves the branch behind main; users need main's latest features plus their own specific changes, not a blunt last-writer-wins overwrite. Per-feature selection is the safe reconciliation for a parametric feature tree.
- **Verification:** Merge reconcile keeps main's latest features and applies selected branch features; the history Branches-tab Merge button opens the feature picker.
- **Validation:** A user merges main into a stale branch, picks which branch features to keep, and ends up with main's latest plus those features.

### REQ 747 — Full merge list (features + sketches)

- **Description:** The merge tool shall list every feature AND sketch that differs between main and the branch (added/removed/changed), pre-select all of them by default (a full merge), and let the user untick any item to keep main's version. Applying takes the branch's version of each ticked item and keeps main's for unticked ones.
- **Rationale:** The prior tool listed only features and pre-selected just newly-added ones, so branch removals/modifications were silently dropped and sketch-only edits were invisible.
- **Verification:** Merge panel lists features+sketches, all selected by default.
- **Validation:** Applying with all ticked reproduces the branch geometry exactly; unticking an item keeps main's version of just that item.

---

## Succinct description

There is no automatic whole-tree merge. Two explicit primitives reconcile across branches: **cherry-pick** (splice one feature + its sketches into the working copy) and a **feature-level merge** that starts from main's current doc and applies the user-selected branch features and sketches, committing onto the branch with main's head as parent. Both live in `cadBranchService.js`.

---

## How it works — for everyone (non-technical)

The system deliberately never tries to auto-merge two designs — for a parametric model that's unreliable, so reconciliation is always something you choose explicitly.

The simplest tool is **cherry-pick**: grab one specific feature from another version and drop it into what you're working on. Just that one feature (and the sketches it needs come along with it).

The bigger tool is **merge**, used when your branch has fallen behind the official line because someone else released first. It starts from main's *latest* and then offers you a checklist of every feature and sketch that differs on your branch — added, removed, or changed. Everything is ticked by default (a full merge), but you can untick anything you'd rather take main's version of. Apply it, and your branch now has main's latest plus exactly the changes you chose. There's a live 3D preview of the result so you can see what you'll get before committing.

---

## How it works — in detail (technical)

### Cherry-pick (`cherryPick`, REQ 696, 697)

`cherryPick(model, sourceCommit, featureId)` reads the source commit's doc, finds the feature by id, then deep-clones the working copy's `featureTree`/`sketchDoc` and splices the feature in (replacing one with the same id, else appending) along with the sketches it references (`referencedSketchIds` — scans `sketchId`, `sketchIds`, and any `*SketchId` field). It sets `dirty: true`. No history merge — cherry-pick is the **only** cross-branch reconciliation primitive (REQ 697; there is no auto-merge method on the service).

### Behind-main detection

`behindMain(model)` (see [Branches](./branches.md)) is true when main's head is not in the branch's ancestry. A behind-main branch is blocked from release; the editor's behind-main control and the history Branches-tab surface a **Merge** action.

### Feature-level merge (`mergedReconcileDoc` → `reconcileBranch`, REQ 741, 747)

`mergedReconcileDoc(model, branchName, sel)` builds the merged doc **without committing** — used by both the merge commit and the live 3D preview. `sel = { featureIds, sketchIds }` are the differing items the user chose to take from the branch (a bare array is treated as `featureIds` for back-compat).

It starts from **main's current doc** (deep-cloned) and, for each selected `featureId`:

- the branch has that feature → splice it in (replace or append) plus its referenced sketches;
- the branch lacks it (a branch deletion) → remove it from main's tree.

Each selected `sketchId` independently takes the branch's version, or is dropped if the branch deleted it (catching a sketch edited without changing the feature that consumes it). Unselected items keep main's version.

`reconcileBranch(model, sel, userId)` (rejected while dirty) serializes the merged doc to a tree and `createCommit`s it with **`parents = [mainHead]`** — so the branch is now up to date with main *and* carries the chosen branch changes — then advances the branch ref and re-bases the working copy.

```mermaid
flowchart TB
  MAIN["main current doc\n(latest features)"] --> BASE["clone as base"]
  BRANCH["branch doc"] --> SEL{"selected\nfeatureIds / sketchIds"}
  SEL -->|branch has it| SPLICE["splice in\n+ referenced sketches"]
  SEL -->|branch deleted it| REMOVE["remove from base"]
  BASE --> RESULT["merged doc"]
  SPLICE --> RESULT
  REMOVE --> RESULT
  RESULT -->|commit parents=[mainHead]| COMMIT["new commit on branch"]
```

### Whole-tree rebase (superseded in UI)

`rebaseBranch` also exists — it re-commits the branch's whole tree with main's head as parent (last-writer-wins). It remains for completeness but the UI drives the feature-level merge instead, because the user wanted "main's latest + specific branch changes", not a blunt overwrite.

### UI (`cad-revision-list.component.ts`)

The history **Branches** tab shows a **Merge** button on behind-main branches; it opens a merge panel listing every differing feature and sketch (pre-ticked) with a live `app-cad-preview-3d` of the merge result (and per-feature apply errors). The backend `reconcile` / `reconcilePreview` controller handlers accept `{ featureIds, sketchIds }`.

### Assembly parallel

`assemblyBranchService.js` is the assembly-side equivalent binding over the same generic branch ops, providing the analogous cross-branch reconciliation for assemblies.

---

## Key files

- `backend/services/vcs/cadBranchService.js` — `cherryPick`, `referencedSketchIds`, `behindMain`, `mergedReconcileDoc`, `reconcileBranch`, `rebaseBranch`
- `backend/services/vcs/assemblyBranchService.js` — assembly-side reconciliation binding
- `backend/api/design/cad-model/controller.js` — `reconcileBranch` / `reconcilePreview` handlers
- `frontend/src/app/components/cad/cad-revision-list/cad-revision-list.component.ts` — Merge panel (features + sketches + 3D preview)
