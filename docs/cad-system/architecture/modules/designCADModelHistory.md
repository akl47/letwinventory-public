# DesignCADModelHistory

> **System** ▸ [Overview](../../00-overview.md) ▸ [Architecture](../../50-architecture.md) ▸ [Data Model](../data-model.md) ▸ **DesignCADModelHistory**
> Related: [designCADModel](./designCADModel.md) · [designAssemblyHistory](./designAssemblyHistory.md)

---

## Requirements

Requirements: governed by [Data Model](../data-model.md). This table is pure audit infrastructure. The closest direct requirement is REQ 551 (persist the CAD model to the server with auditable history) and REQ 677 (track working-copy mutations). No single REQ id targets this table exclusively; it satisfies the broader audit-trail mandate that applies across the design domain.

---

## Succinct description

`DesignCADModelHistory` is an append-only, human-facing audit log for working-copy mutations — one row per significant change to a `DesignCADModel` row.

---

## How it works — for everyone (non-technical)

Every time the system makes a meaningful change to a CAD model record (creating it, updating it, locking it, releasing it), it writes a line in this log. The log records who made the change, when, and what the before/after state looked like. It is the paper trail that answers "who released this and when?" — separate from the VCS commit history, which records geometry snapshots.

---

## How it works — in detail (technical)

**Source:** `backend/models/design/designCADModelHistory.js`, table `DesignCADModelHistory`.

`timestamps: false` — the model manages `createdAt` explicitly; there is no `updatedAt` column (rows are write-once).

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | INTEGER | PK, autoIncrement | |
| `cadModelID` | INTEGER | not null | FK → `DesignCADModels.id` |
| `changeType` | STRING(30) | not null | Verb label, e.g. `created`, `updated`, `checkout`, `checkin`, `released` |
| `changedByUserID` | INTEGER | not null | FK → `Users.id` |
| `previousState` | JSONB | nullable | Working-copy snapshot before the change |
| `newState` | JSONB | nullable | Working-copy snapshot after the change |
| `createdAt` | DATE | not null | Write timestamp |

### Associations

| Relation | Target | FK | Alias |
|----------|--------|----|-------|
| belongsTo | `DesignCADModel` | `cadModelID` | `cadModel` |
| belongsTo | `User` | `changedByUserID` | `changedBy` |

### Notes

- **No indexes** beyond the implicit PK. Queries are typically `WHERE cadModelID = ?` — add an index there if history tables grow large.
- **`tablesToClean` ordering:** `DesignCADModelHistory` must appear before `DesignCADModel` (and `Part` / `User`) in `backend/tests/setup.js` because the `cadModelID` FK uses `onDelete: RESTRICT`.
- `previousState` / `newState` carry whatever slice of the working-copy the controller deems relevant for the change type. There is no enforced sub-schema — consumers should treat both columns as informational.

---

## Key files

- `backend/models/design/designCADModelHistory.js` — model definition
- `backend/api/design/cad-model/controller.js` — writes history rows on create/update/lock/release
- `backend/tests/setup.js` — `tablesToClean` ordering
