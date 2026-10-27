# DesignAssemblyHistory

> **System** ▸ [Overview](../../00-overview.md) ▸ [Architecture](../../50-architecture.md) ▸ [Data Model](../data-model.md) ▸ **DesignAssemblyHistory**
> Related: [designAssembly](./designAssembly.md) · [designCADModelHistory](./designCADModelHistory.md)

---

## Requirements

Requirements: governed by [Data Model](../data-model.md). This table is pure audit infrastructure, parallel to `DesignCADModelHistory`. No single REQ id targets it exclusively; it satisfies the audit-trail mandate common to all design domain working copies.

---

## Succinct description

`DesignAssemblyHistory` is an append-only audit log for mutations to an assembly working copy — the direct structural counterpart of `DesignCADModelHistory` for the assembly document.

---

## How it works — for everyone (non-technical)

Whenever the system changes an assembly record (creates it, saves it, locks it, releases it), it appends a row here recording who acted, when, and what changed. This gives reviewers and administrators a human-readable history of the assembly's administrative lifecycle, separate from the VCS commit graph that records geometry history.

---

## How it works — in detail (technical)

**Source:** `backend/models/design/designAssemblyHistory.js`, table `DesignAssemblyHistory`.

`timestamps: false` — the model manages `createdAt` explicitly; rows are write-once.

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | INTEGER | PK, autoIncrement | |
| `assemblyID` | INTEGER | not null | FK → `DesignAssemblies.id` |
| `changeType` | STRING(30) | not null | Verb label, e.g. `created`, `updated`, `checkout`, `released` |
| `changedByUserID` | INTEGER | not null | FK → `Users.id` |
| `previousState` | JSONB | nullable | Working-copy snapshot before the change |
| `newState` | JSONB | nullable | Working-copy snapshot after the change |
| `createdAt` | DATE | not null | Write timestamp |

### Associations

| Relation | Target | FK | Alias |
|----------|--------|----|-------|
| belongsTo | `DesignAssembly` | `assemblyID` | `assembly` |
| belongsTo | `User` | `changedByUserID` | `changedBy` |

### Notes

- Schema is identical to `DesignCADModelHistory` with `assemblyID` in place of `cadModelID`.
- `tablesToClean` in `backend/tests/setup.js` must list `DesignAssemblyHistory` before `DesignAssembly` and before `Part` / `User` (FK RESTRICT).
- `previousState` / `newState` carry informational snapshots; their sub-schema is not enforced at the model layer.

---

## Key files

- `backend/models/design/designAssemblyHistory.js` — model definition
- `backend/api/design/assembly/controller.js` — writes history rows
- `backend/tests/setup.js` — `tablesToClean` ordering
