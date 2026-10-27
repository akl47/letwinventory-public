# VcsChangeset

> **System** ▸ [Overview](../../00-overview.md) ▸ [Architecture](../../50-architecture.md) ▸ [Data Model](../data-model.md) ▸ **VcsChangeset**
> Related: [vcsObject](./vcsObject.md) · [vcsUsage](./vcsUsage.md) · [VCS subsystem](../../30-vcs.md)

---

## Requirements

Requirements: governed by [Data Model](../data-model.md). `VcsChangeset` is a reserved infrastructure seam with no currently active REQ of its own. It is pre-wired so the cross-repo relationship can be recorded from the first assembly commit without an object-model migration. Atomic enforcement is deferred to when the assembly editor requires it.

---

## Succinct description

`VcsChangeset` is a reserved table that groups commits made across multiple repositories into one logical, named check-in — for example, "edited part X and the assembly that uses it in the same save operation."

---

## How it works — for everyone (non-technical)

Sometimes you change two related documents in the same sitting: you adjust a part's geometry and update the assembly that uses it. Eventually the system will let you save both together under one named description, so history shows them as a single unit. This table is the placeholder for that capability — it exists now so the database design supports it from day one, even though the assembly editor that triggers it is not yet complete.

---

## How it works — in detail (technical)

**Source:** `backend/models/vcs/vcsChangeset.js`, table `VcsChangesets`.

`updatedAt: false` — changesets are write-once records.

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | INTEGER | PK, autoIncrement | |
| `description` | STRING(1024) | nullable | Human-readable description of the cross-repo change |
| `authorUserID` | INTEGER | nullable | FK → `Users.id` |
| `commits` | JSONB | not null, default `[]` | Array of `{ repoType, repoId, commitHash }` — the commits this changeset bundles |
| `createdAt` | DATE | not null | |

### Status

The table is created by migration and the model is loaded by Sequelize on startup, but **no application code currently writes to it**. It exists to establish the schema seam:

- When assembly commits are written that reference a simultaneously-edited child part, the controller will insert a `VcsChangeset` row bundling both commits.
- Until then the table stays empty.

### Relationship to VcsUsage

`VcsUsage` records the *structural* parent-child edge (assembly uses part at a specific commit). `VcsChangeset` records the *temporal* coupling (both changed together in one user action). They are complementary, not redundant.

---

## Key files

- `backend/models/vcs/vcsChangeset.js` — model definition (reserved)
