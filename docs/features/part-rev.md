# Part Revisions Feature Spec

## Context

Parts currently have no revision tracking. When a part design changes, there's no way to distinguish the old version from the new one, and no audit trail of what changed. This feature adds a revision field to every part, making **part name + revision** a unique identifier. Each revision is its own row in the Parts table, so existing foreign keys (traces, BOMs, orders, harness elements) inherently reference a specific revision without schema changes to those tables.

## Requirements (REQ 220-227)

| ID | Title |
|----|-------|
| 220 | Part Revision Field |
| 221 | Part Revision Lock |
| 222 | Create New Development Revision |
| 223 | Release to Production |
| 224 | Part Revision History |
| 225 | Part Revision Chain |
| 226 | Part Revision Display in UI |
| 227 | Part Edit Page Revision Controls |

## Requirements Summary

### Schema
- Add `revision` STRING column to Parts table (not null, default `'0'`)
- Replace unique constraint on `name` with unique constraint on `(name, revision)`
- Add `revisionLocked` BOOLEAN column (default false) — locked revisions cannot be edited
- Add `previousRevisionID` INTEGER column (nullable, FK to Parts) — links revision chain
- Create `PartRevisionHistory` table for audit trail

### Revision Scheme
- **External (vendor) parts**: default to revision `0` (editable — vendor parts can have revisions too, but `0` is the default)
- **Internal parts — development**: start at `01`, increment numerically (`01`→`02`→`03`...) matching harness convention
- **Internal parts — production**: letter revisions (`A`→`B`→`C`→...→`Z`→`AA`→`AB`) created via explicit "Release to Production" action
- Revision is set on creation and incremented via explicit "Create New Revision" (dev) or "Release to Production" (prod) actions

### Behavior
- **Edit in-place**: editing a part modifies the current revision (unless locked)
- **Create New Revision (dev)**: duplicates the part record with the next numeric revision (`01`→`02`), copies BOM, links via `previousRevisionID`
- **Release to Production**: creates a new part record with the next letter revision (`A`, `B`, etc.), copies BOM, links via `previousRevisionID`. This is the production-ready version.
- **Lock revision**: prevents all edits to that revision. Unlockable.
- **Part Revision History**: records all mutations (create, update, lock, unlock, new_revision, production_release) with user, timestamp, and field-level diffs

### Display
- Part number displayed as `{name} Rev {revision}` throughout the app
- Parts table shows revision column
- Part edit page shows revision in header, lock toggle, "New Revision" button (dev), "Release to Production" button (prod)
- Revision history timeline on part edit page (collapsible, like requirement history)

### Touchpoints
- **Parts table**: revision column, filter/sort
- **Part edit page**: revision display, lock/unlock, create new revision, history
- **BOM editor**: shows part+rev for each line item
- **Inventory/traces**: already reference partID (which is a specific revision)
- **Orders**: already reference partID
- **Harness editor**: already references partID
- **Build page**: BOM lines show part+rev
- **Mobile scanner**: part info shows revision
- **Barcode history**: part references show revision

## API Contracts

### Modified Endpoints

**POST /api/inventory/part** (createNewPart)
- Add optional `revision` field to request body
- Default: `'0'` for external parts, `'A'` for internal parts
- Validate uniqueness of `(name, revision)`

**PUT /api/inventory/part/:id** (updatePartByID)
- Reject if `revisionLocked` is true (403)
- Record change in PartRevisionHistory

### New Endpoints

**POST /api/inventory/part/:id/new-revision**
- Creates a new part record with next **numeric** (development) revision
- E.g., `01`→`02`, `02`→`03`
- Copies all fields, BOM items, and image reference
- Sets `previousRevisionID` to source part ID
- Returns the new part record
- Request body: `{}` (no fields needed — auto-increments revision)
- Response: `{ id, name, revision, ... }` (the new part)

**POST /api/inventory/part/:id/release**
- Creates a new part record with next **letter** (production) revision
- E.g., first release → `A`, then `A`→`B`, `B`→`C`
- Finds the latest letter revision for this part name and increments
- Copies all fields, BOM items, and image reference
- Sets `previousRevisionID` to source part ID
- Returns the new part record
- Request body: `{}` (no fields needed — auto-increments revision)
- Response: `{ id, name, revision, ... }` (the new part)

**PUT /api/inventory/part/:id/lock**
- Sets `revisionLocked = true`
- Records in history
- Response: `{ success: true }`

**PUT /api/inventory/part/:id/unlock**
- Sets `revisionLocked = false`
- Records in history
- Response: `{ success: true }`

**GET /api/inventory/part/:id/revision-history**
- Returns array of PartRevisionHistory entries for this part
- Includes user display name
- Ordered by createdAt DESC

**GET /api/inventory/part/revisions/:name**
- Returns all revisions of a part by name (all rows with that name)
- Ordered by createdAt ASC
- Used for "view all revisions" UI

## Database Changes

### Migration: Add revision fields to Parts

```sql
ALTER TABLE Parts ADD COLUMN revision VARCHAR(8) NOT NULL DEFAULT '0';
ALTER TABLE Parts ADD COLUMN revisionLocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE Parts ADD COLUMN previousRevisionID INTEGER REFERENCES Parts(id) ON DELETE SET NULL;

-- Replace unique index on name with composite unique index
DROP INDEX parts_name_unique;
CREATE UNIQUE INDEX parts_name_revision_unique ON Parts(name, revision);
```

### New Table: PartRevisionHistory

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| partID | INTEGER FK | References Parts.id, CASCADE delete |
| changedByUserID | INTEGER FK | References Users.id, SET NULL on delete |
| changeType | STRING | 'created', 'updated', 'locked', 'unlocked', 'new_revision' |
| changes | JSONB | Field-level diffs: `{ field: { old, new } }` |
| createdAt | DATE | Timestamp |

## UI Design

### Parts Table
- New "Rev" column after Part Number column
- Sortable by revision

### Part Edit Page
- Header shows: `{part name} Rev {revision}` with lock icon if locked
- Lock/unlock toggle button (lock icon) next to revision display
- "New Revision" button (creates next dev numeric revision) in header actions
- "Release to Production" button (creates next prod letter revision) in header actions
- Both buttons disabled if part is new/unsaved
- Locked parts: all form fields disabled, "This revision is locked" banner
- Collapsible "Revision History" section at bottom (like requirement history)
- "All Revisions" link/section showing other revisions of this part

### BOM Editor (Part Edit Page)
- Part name column shows `{name} Rev {rev}` for each BOM line

### Build Page
- BOM line part names show revision

### Mobile Scanner / Barcode History
- Part info displays revision when showing part details

## Test Scenarios

### Backend Tests
1. Create part with default revision (external defaults to '0', internal defaults to '01')
2. Create new dev revision increments correctly (01→02, 02→03)
3. Release to production creates letter revision (first → A, then A→B)
4. Create new revision copies BOM items
5. Create new revision sets previousRevisionID
6. Cannot create duplicate name+revision
7. Cannot edit locked revision (403)
8. Lock/unlock endpoints work
9. Revision history recorded on create, update, lock, unlock, new_revision, production_release
10. Get revision history returns correct entries with user info
11. Get all revisions by name returns all matching parts

### Frontend Tests
1. Part edit page shows revision in header
2. Lock toggle enables/disables form fields
3. New Revision button calls API (dev rev) and navigates to new part
3b. Release to Production button calls API (prod rev) and navigates to new part
4. Revision history section displays correctly
5. Parts table shows revision column
6. BOM editor shows part+rev

### E2E Tests
1. Create internal part → has revision A
2. Create new dev revision → navigates to Rev 02
3. Release to production → navigates to Rev A
4. Lock revision → form becomes read-only
5. Parts table shows revision column with correct values

## Implementation Notes

### Files to Create
- `backend/migrations/YYYYMMDD000000-add-part-revisions.js`
- `backend/models/inventory/partRevisionHistory.js`

### Files to Modify
- `backend/models/inventory/part.js` — add revision, revisionLocked, previousRevisionID fields + associations
- `backend/api/inventory/part/controller.js` — new-revision, lock, unlock, revision-history endpoints + update validation
- `backend/api/inventory/part/routes.js` — new routes
- `backend/tests/setup.js` — PartRevisionHistory cleanup
- `frontend/src/app/models/part.model.ts` — add revision, revisionLocked, previousRevisionID
- `frontend/src/app/services/inventory.service.ts` — new API methods
- `frontend/src/app/components/inventory/part-edit-page/` — revision UI, lock, history
- `frontend/src/app/components/inventory/parts-table-view/` — revision column
- `frontend/src/app/components/inventory/barcode-history/` — show part+rev
- `frontend/src/app/components/build/build-view/` — BOM part+rev display
- `frontend/src/app/components/mobile/mobile-scanner/` — part+rev in display

### Existing Patterns to Follow
- Harness revision logic in `backend/api/parts/harness/controller.js` (getNextLetterRevision, revision chain)
- RequirementHistory pattern for PartRevisionHistory (field-level diffs, user tracking)
- Harness `previousRevisionID` pattern for revision chain linking
