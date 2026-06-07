# assemblyVcsService — Assembly VCS Binding

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Working Copy / Check-out / Check-in](../working-copy-checkout-checkin.md) ▸ **assemblyVcsService**
> Related: [vcsWorkingCopy](./vcsWorkingCopy.md) · [vcsRelease](./vcsRelease.md) · [assemblyFreezeService](./assemblyFreezeService.md) · [assemblyBranchService](./assemblyBranchService.md)

---

## Requirements

Requirements governed by [Working Copy / Check-out / Check-in](../working-copy-checkout-checkin.md). The assembly binding mirrors the CAD binding under the same REQs (677–681, 688).

---

## Succinct description

The assembly-specific VCS binding: wires `repoForAssembly` (lineage-root repo key with `repoType = 'assembly'`), the assembly serializer, and assembly freeze service into the shared `makeWorkingCopy` and `makeRelease` factories — an even thinner adaptor than `cadVcsService`.

## How it works — for everyone (non-technical)

Assemblies get the same checkout/check-in/version-history capability as individual parts. This module is the thin adaptor that says "use the assembly document format, key the repository to the part lineage root, and store geometry with the assembly renderer." Everything else is shared with the CAD binding.

## How it works — in detail (technical)

`backend/services/vcs/assemblyVcsService.js` is a **thin binding** — even thinner than `cadVcsService` because it omits CAD-specific extras (thumbnail storage, dev release, derived draft revision, lock sweep).

### `repoForAssembly(assembly, db) → { repoType: 'assembly', repoId: string }`

Same lineage-walk as `cadVcsService.repoForModel` but uses `repoType: 'assembly'`, ensuring the assembly history never collides with a CAD history for the same part.

### `docOf(assembly)`

Returns `assembly.assemblyDoc || { nextInstanceSeq: 1, nextMateSeq: 1, instances: [], mates: [] }`.

### `applyDoc`

`(model, doc) => ({ assemblyDoc: doc })` — the reverse of `docOf`.

### `seedMain(assembly, userId, opts, db)`

Delegates to `wc.seedMain`, then writes `baseCommitHash` back to the `DesignAssembly` row if it was not already set — so the assembly's version history is visible from creation.

### Release

`release` is built by `makeRelease` with `assemblyFreeze` as the freeze binding. No separate "dev release" function: assembly release is called directly from the controller with the appropriate permission check.

### Export surface

```
repoForAssembly, docOf, seedMain, release,
checkout, releaseLock, undoCheckout, checkin, history
```

## Key files

- `backend/services/vcs/assemblyVcsService.js` — the binding
- `backend/services/vcs/vcsWorkingCopy.js` — `makeWorkingCopy`
- `backend/services/vcs/vcsRelease.js` — `makeRelease`
- `backend/services/vcs/assemblyFreezeService.js` — freeze binding
