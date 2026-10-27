# vcsBranchOps — Branch Operations Factory (makeBranchOps)

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Branches](../branches.md) ▸ **vcsBranchOps**
> Related: [cadBranchService](./cadBranchService.md) · [assemblyBranchService](./assemblyBranchService.md) · [vcsService](./vcsService.md) · [Architecture: unified bindings](../../architecture/unified-vcs-bindings.md)

---

## Requirements

Requirements governed by [Branches](../branches.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 692 | unapproved | Create a named variant branch at a chosen commit |
| 693 | unapproved | List branches of a repository |
| 694 | unapproved | Switch working copy to another branch |
| 695 | unapproved | Archive (remove) a branch; current branch and `main` are protected |

### REQ 694 — Branch switch

- **Description:** Switching the working copy to another branch shall load that branch's head state into the working copy; switching with uncommitted changes shall be rejected with 409.
- **Rationale:** A branch switch replaces the editable state; rejecting it while dirty prevents silent loss of uncommitted changes.
- **Verification:** Integration test: switch loads the branch doc and updates branch/baseCommit; switch with `dirty=true` returns 409.
- **Validation:** A user can move between variant branches and always sees that branch's geometry, without losing uncommitted changes.

---

## Succinct description

A written-once factory (`makeBranchOps`) that produces the create / list / switch / archive operations for any version-controlled document's branches; CAD and assembly each bind it by supplying their repo resolver and deserializer.

## How it works — for everyone (non-technical)

Switching between different design alternatives (branches) works the same way for parts and assemblies. This factory captures that logic once. Each document type plugs in only the part that is unique to it: how to find its storage address and how to load its specific document format.

## How it works — in detail (technical)

`backend/services/vcs/vcsBranchOps.js` exports `makeBranchOps(binding)`.

### Binding contract

```js
{
  repoFor(model, db),           // async → { repoType, repoId }
  deserialize(repo, hash, db),  // async → document
  applyDoc(model, doc),         // → model.update() patch
}
```

### Returned operations

| Function | Guards | Description |
|---|---|---|
| `createBranch(model, name, {fromCommit}, userId, db)` | 409 if name exists | Creates a branch ref at `fromCommit` (default: current head) |
| `listBranches(model, db)` | — | Calls `vcs.listRefs(repo, 'branch')` |
| `switchBranch(model, name, userId, db)` | 409 if dirty; 404 if branch not found | Loads branch head doc into working copy; sets `releaseLocked = (name === 'main')` |
| `archiveBranch(model, name, db)` | 409 if current or `main` | Calls `vcs.deleteRef`; objects remain |

### `switchBranch` detail

Setting `releaseLocked = true` on switch to `main` is the mechanism that enforces the protected-main rule (REQ 734) at the working-copy level: switching to main puts the row into the read-only state immediately, without needing to check the branch name on every subsequent request.

Cherry-pick, reconcile, and rebase are content-specific and live in `cadBranchService` / `assemblyBranchService`, not here.

## Key files

- `backend/services/vcs/vcsBranchOps.js` — `makeBranchOps`
- `backend/services/vcs/cadBranchService.js` — CAD binding + cherry-pick / reconcile / rebase
- `backend/services/vcs/assemblyBranchService.js` — assembly binding + reconcile
