# cadVcsService — CAD VCS Binding

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Working Copy / Check-out / Check-in](../working-copy-checkout-checkin.md) ▸ **cadVcsService**
> Related: [vcsWorkingCopy](./vcsWorkingCopy.md) · [vcsRelease](./vcsRelease.md) · [cadFreezeService](./cadFreezeService.md) · [cadBranchService](./cadBranchService.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 677 | unapproved | Working copy binds to a checked-out branch |
| 683 | unapproved | Every commit records kernel and naming-schema version |
| 688 | unapproved | One repo per part lineage, continuous across Part revisions |
| 715 | unapproved | Design must be checked in before release |
| 716 | unapproved | Dev release is self-service (cad.write) |
| 718 | unapproved | After dev release, design and Part revision are locked read-only |
| 734 | unapproved | Protected main branch |
| 735 | unapproved | Draft branch displayed revision derived as highest released numeric + 1 |

### REQ 688 — Lineage-keyed repository

- **Description:** Each part lineage shall have exactly one version-control repository whose commit history is continuous across the part's manufacturing revisions; the repository shall be keyed to the lineage-root Part record, not to the working-copy row.
- **Rationale:** Revisions create new Part rows linked by `previousRevisionID`; keying the repository to the lineage keeps history visible and unbroken across those rows.
- **Verification:** Integration test: creating a new Part revision continues the same repository and history.
- **Validation:** A user sees one continuous history for a part across all of its revisions.

### REQ 716 — Self-service development release

- **Description:** A development release shall be self-service, requiring only `cad.write` (no approval workflow).
- **Rationale:** Development releases are internal engineering checkpoints; approval would slow iteration.
- **Verification:** A `cad.write` user with no approve permission can create a development release.
- **Validation:** A `cad.write` user with no approve permission can create a development release.

---

## Succinct description

The CAD-specific VCS binding: wires `repoForModel` (lineage-root repo key), the CAD serializer, and freeze service into the written-once `makeWorkingCopy` and `makeRelease` factories, then adds CAD-only concerns (dev release, thumbnail storage, lock sweep, derived draft revision).

## How it works — for everyone (non-technical)

This is the thin adaptor that connects the CAD editor to the generic version-control machinery. It answers questions like "where does this part's history live?" and "which revision number would be assigned if we released right now?" — and it calls the shared lock/check-in/release procedures with those answers.

## How it works — in detail (technical)

`backend/services/vcs/cadVcsService.js` is a **thin binding**, not a written-once factory. It delegates all checkout/lock/check-in/history logic to `makeWorkingCopy` and all release plumbing to `makeRelease`.

### Key responsibilities

#### `repoForModel(model, db) → { repoType: 'cad', repoId: string }`

Walks `Part.previousRevisionID` to the root, returning that root's `id` as the `repoId`. A cycle guard prevents infinite loops on corrupt data.

#### `cadVersionInfo() → { kernelVersion, namingVersion }`

Stamped into every commit's `meta` via the `commitMeta` binding hook (REQ 683). Uses `NAMING_VERSION` from `cadRegenService`.

#### `derivedDraftRev(model, db) → string`

Queries all `Parts` with the same `name`, finds the max numeric revision (`/^\d+$/`), and returns `(max + 1)` zero-padded to 2 digits. This is DERIVED — never stored — so all concurrent draft branches show the same number and it auto-bumps when a release happens (REQ 735).

#### `devRelease(model, userId, {kernelClient, at}, db)`

Calls `vcsRelease.release(model, ..., part.revision)` then sets `model.releaseLocked = true` and `part.revisionLocked = true`. Guards: `releaseLocked` (409) and `dirty || !baseCommitHash` (409). Does not call the approval workflow — self-service.

#### Thumbnail storage (REQ 710)

`storeThumbnail(model, commitHash, dataUrl, db)` and `loadThumbnail(model, commitHash, db)` — a commit's low-resolution PNG captured client-side at check-in. Stored in `VcsObject` with a synthetic `hash = sha256("thumb:<commitHash>")` (a 64-char key) under kind `'thumbnail'`. Not content-addressed (keyed per commit, not per pixel content) because the caller needs to look it up by commit hash.

#### `sweepExpiredLocks(at, db)`

Batch `DesignCADModel.update` clearing `lockedByUserID/lockedAt/lockExpiresAt` for all rows whose `lockExpiresAt` is in the past (REQ 679). Called by a periodic job.

### Export surface

```
repoForModel, cadVersionInfo, derivedDraftRev, padNumeric,
highestReleasedNumeric, seedMain, checkout, releaseLock,
undoCheckout, checkin, release, devRelease, markDirty,
history, sweepExpiredLocks, storeThumbnail, loadThumbnail,
DEFAULT_LOCK_TTL_MS
```

Most of these are thin re-exports of the `makeWorkingCopy` instance (`wc.seedMain`, `wc.checkout`, etc.).

## Key files

- `backend/services/vcs/cadVcsService.js` — the binding
- `backend/services/vcs/vcsWorkingCopy.js` — `makeWorkingCopy` (checkout/check-in/lock)
- `backend/services/vcs/vcsRelease.js` — `makeRelease` (freeze + tag + advance)
- `backend/services/vcs/cadFreezeService.js` — freeze binding
- `backend/services/cadRegenService.js` — `NAMING_VERSION` source
