# vcsService — Content-Addressed Store Kernel

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Content-Addressed Store](../content-addressed-store.md) ▸ **vcsService**
> Related: [canonicalJson](./canonicalJson.md) · [cadSerializer](./cadSerializer.md) · [vcsWorkingCopy](./vcsWorkingCopy.md) · [Architecture: unified bindings](../../architecture/unified-vcs-bindings.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 669 | unapproved | Objects identified by SHA-256 of canonical content |
| 670 | unapproved | Canonical serialization: equal logical content → equal bytes |
| 671 | unapproved | Three core object kinds: blob, tree, commit |
| 672 | unapproved | Commit carries tree, parents, author, message, timestamp, meta |
| 673 | unapproved | Named refs per repo: mutable branches, write-once tags |
| 674 | unapproved | Walk commit ancestry newest-to-oldest, deduplicating shared ancestors |
| 675 | unapproved | Binary objects (frozen geometry) addressed by byte-content hash |

### REQ 669 — Content addressing

- **Description:** The version-control store shall identify every stored object by a SHA-256 hash of its canonical serialized content, and shall deduplicate: two objects with equal content shall be stored as a single row.
- **Rationale:** Content addressing gives immutable, tamper-evident identity and O(changes) storage via structural sharing — identical content is stored once, and a hash both names and verifies an object.
- **Verification:** Unit test: identical content stores one row and the same hash regardless of key order; different content yields different hashes.
- **Validation:** Editing one feature and re-committing a model does not duplicate the unchanged features in storage.

### REQ 673 — Named refs (branches and tags)

- **Description:** The version-control store shall provide named references scoped to a repository identified by `(repoType, repoId)`: branches are mutable pointers to commits; tags are write-once markers.
- **Rationale:** Branches enable variant lines of development; write-once tags provide immutable release markers; per-repo scoping keeps CAD and assembly histories independent.
- **Verification:** Unit test: a branch advances; a tag is rejected on duplicate creation; refs are isolated per repo.
- **Validation:** A user can create a variant branch and a permanent release tag on a model independently of other models.

---

## Succinct description

The domain-agnostic, content-addressed object store that underpins the entire VCS layer — a minimal git-like kernel implementing blob/tree/commit objects, mutable branch refs, write-once tags, and ancestor traversal.

## How it works — for everyone (non-technical)

Think of this as the filing system for 3D model versions. Every piece of information — a feature, a sketch, a whole snapshot — is stored in a cabinet drawer identified by its own unique fingerprint. If two snapshots share an identical feature, there is only one copy in the drawer. The "branches" on the cabinet say which snapshot each line of work currently points to, and "tags" are locked labels that cannot be moved once placed (they mark official releases).

## How it works — in detail (technical)

`backend/services/vcs/vcsService.js` is pure infrastructure — it contains no CAD or assembly logic.

### Hashing

Two hash functions build the content address:

- `hashJson(kind, content)` — prepends the object kind string (`"blob "`, `"tree "`, `"commit "`) to the canonical JSON before hashing, so a blob and tree with otherwise-identical content never collide.
- `hashBinary(kind, bytes)` — same prefix trick over raw bytes, used for frozen geometry stored via `putBinary`.

Both emit a 64-character lowercase hex SHA-256 digest.

### Object store

All objects share the `VcsObject` table keyed by `(repoType, repoId, hash)`.

```mermaid
flowchart TB
    blob["blob\n(leaf unit)"]
    tree["tree\n({ entries: [{name, kind, hash}] })"]
    commit["commit\n({ treeHash, parents, authorUserID,\nmessage, timestamp, meta })"]
    geometry["geometry\n(binary BRep bytes)"]
    blob --> tree
    tree --> commit
    commit -. meta.frozen .-> geometry
```

| Function | What it does |
|---|---|
| `writeBlob(repo, content, db)` | Store a JSON leaf; returns hash |
| `writeTree(repo, entries, db)` | Store an ordered `[{name, kind, hash}]` array; returns hash |
| `readTree(repo, hash, db)` | Retrieve entries array for a tree hash |
| `createCommit(repo, {treeHash, parents, authorUserID, message, timestamp, meta}, db)` | Store a commit; returns hash |
| `getCommit(repo, hash, db)` | Retrieve commit content or null |
| `putObject(repo, {kind, content}, db)` | Low-level JSON store (used by the above) |
| `putBinary(repo, kind, bytes, db)` | Store binary bytes; returns hash |
| `getObject(repo, hash, db)` | Retrieve `{kind, content, bytes}` or null |

### Refs

`VcsRef` rows carry `(repoType, repoId, name, kind, targetHash)`.

| Function | Behaviour |
|---|---|
| `createBranch` | Creates a new mutable branch; fails if name exists |
| `updateBranch` | Advances an existing branch to a new commit |
| `createTag` | Creates a write-once tag; throws if name already exists (REQ 673) |
| `deleteRef` | Removes a ref (archiving); objects are never deleted |
| `getRef` / `listRefs` | Read refs, optionally filtered by kind |

### Ancestry traversal

`walk(repo, commitHash, db)` does a BFS from the given hash, deduplicating shared ancestors, returning `[{hash, ...commitContent}]` newest-to-oldest. `log(repo, refName, db)` resolves the ref first then delegates to `walk`.

A repo is always `{ repoType: 'cad' | 'assembly', repoId: string }` — never a table row.

## Key files

- `backend/services/vcs/vcsService.js` — the full kernel (hashing, objects, refs, traversal)
- `backend/services/vcs/canonicalJson.js` — the deterministic serializer that is the linchpin of content addressing
- `backend/models/vcs/` — `VcsObject`, `VcsRef` Sequelize models
