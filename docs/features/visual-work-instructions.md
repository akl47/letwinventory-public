# Visual Work Instructions

## Context

Manufacturing processes require clear, repeatable instructions that operators can follow step-by-step. Currently there is no structured way to define how a part or assembly should be built. Engineering Masters provide version-controlled, visual step-by-step instructions that link to parts and tooling in the inventory system. Work Orders are instances of these masters that operators execute on the shop floor, with per-step completion tracking.

## Requirements

| REQ ID | Title | Description |
|--------|-------|-------------|
| REQ 234 | Engineering Master CRUD | Create, read, update, and delete Engineering Masters with name, description, output parts, and revision control |
| REQ 235 | Engineering Master Steps | Ordered steps (default numbering 10, 20, 30...) with background image, text instructions, parts list, tooling list, and pin markers |
| REQ 236 | Engineering Master Revision Control | Version-controlled masters (01, 02, 03...) with release workflow (draft → review → released); editing a released master creates a new revision |
| REQ 237 | Engineering Master History | Immutable audit trail of all changes to an Engineering Master |
| REQ 238 | Step Pin Markers | Draggable map-style pin markers on the step canvas, each with a label and x/y position |
| REQ 239 | Step Parts and Tooling | Each step references parts (materials) and tooling (tools) from inventory with quantities; displayed in left sidebar |
| REQ 240 | Engineering Master Output Parts | Each master defines one or more output parts with fixed quantities that it produces |
| REQ 241 | Work Order CRUD | Create Work Orders from a released Engineering Master; track status (not_started, in_progress, complete) |
| REQ 242 | Work Order Step Execution | Operators mark steps complete sequentially; each completion records user ID and timestamp |
| REQ 243 | Work Order Output Quantities | Work Orders produce fixed quantities of output parts as defined by the Engineering Master |
| REQ 244 | Manufacturing Planning Permission | New permission group `manufacturing_planning` (read/write/delete) gating Engineering Master access |
| REQ 245 | Manufacturing Execution Permission | New permission group `manufacturing_execution` (read/write/delete) gating Work Order access |

## API Contracts

### Engineering Master API (`/api/manufacturing/master/`)

**GET /** — List all Engineering Masters
```
Response 200:
[{
  id: 1,
  name: "PCB Assembly Process",
  description: "Standard PCB assembly procedure",
  revision: "A",
  releaseState: "released",
  previousRevisionID: null,
  releasedAt: "2026-04-07T...",
  releasedByUserID: 1,
  createdByUserID: 1,
  activeFlag: true,
  outputParts: [{ partID: 5, quantity: 1, part: { name: "PCB Assy", revision: "B" } }],
  stepCount: 5,
  createdAt: "...",
  updatedAt: "..."
}]
```

**GET /:id** — Get Engineering Master with all steps
```
Response 200:
{
  id: 1,
  name: "PCB Assembly Process",
  description: "...",
  revision: "A",
  releaseState: "draft",
  previousRevisionID: null,
  createdByUserID: 1,
  releasedByUserID: null,
  releasedAt: null,
  activeFlag: true,
  outputParts: [{ id: 1, partID: 5, quantity: 1, part: { id: 5, name: "PCB Assy" } }],
  steps: [{
    id: 1,
    stepNumber: 10,
    title: "Place capacitors",
    instructions: "Place C1-C4 on the PCB per the reference designators shown.",
    imageFileID: 12,
    imageFile: { id: 12, filename: "step1.png", ... },
    parts: [{ id: 1, partID: 3, quantity: 4, isTool: false, part: { name: "Cap 100nF" } }],
    tooling: [{ id: 2, partID: 8, quantity: 1, isTool: true, part: { name: "Tweezers" } }],
    markers: [{ id: 1, label: "C1", x: 120.5, y: 80.3 }, { id: 2, label: "C2", x: 200.0, y: 80.3 }]
  }],
  createdAt: "...",
  updatedAt: "..."
}
```

**POST /** — Create new Engineering Master
```
Request:
{
  name: "PCB Assembly Process",
  description: "Standard PCB assembly procedure",
  outputParts: [{ partID: 5, quantity: 1 }]
}
Response 201: { id: 1, revision: "A", releaseState: "draft", ... }
```

**PUT /:id** — Update Engineering Master (must be draft)
```
Request:
{
  name: "PCB Assembly Process (updated)",
  description: "...",
  outputParts: [{ partID: 5, quantity: 1 }]
}
Response 200: { ... updated master }
Response 400: "Engineering Master must be in draft state to edit"
```

**DELETE /:id** — Soft-delete Engineering Master
```
Response 200: { message: "Engineering Master deleted" }
```

**POST /:id/submit-review** — Draft → Review
```
Response 200: { ... master with releaseState: "review" }
Response 400: "Engineering Master must be in draft state"
Response 400: "Engineering Master must have at least one step"
```

**POST /:id/reject** — Review → Draft
```
Response 200: { ... master with releaseState: "draft" }
Response 400: "Engineering Master must be in review state"
```

**POST /:id/release** — Review → Released
```
Response 200: { ... master with releaseState: "released", releasedAt, releasedByUserID }
Response 400: "Engineering Master must be in review state"
```

**POST /:id/new-revision** — Create new revision from released master
```
Response 201: { id: 2, revision: "B", releaseState: "draft", previousRevisionID: 1, ... }
```

**GET /:id/history** — Get revision history
```
Response 200: [{ id: 1, changeType: "created", changedByUserID: 1, changes: {...}, createdAt: "..." }]
```

**GET /:id/revisions** — Get all revisions of this master
```
Response 200: [{ id: 1, revision: "A", releaseState: "released" }, { id: 2, revision: "B", releaseState: "draft" }]
```

### Engineering Master Step API (`/api/manufacturing/master-step/`)

**POST /** — Create step
```
Request:
{
  engineeringMasterID: 1,
  stepNumber: 10,
  title: "Place capacitors",
  instructions: "Place C1-C4...",
  imageFileID: 12,
  parts: [{ partID: 3, quantity: 4, isTool: false }],
  tooling: [{ partID: 8, quantity: 1, isTool: true }],
  markers: [{ label: "C1", x: 120.5, y: 80.3 }]
}
Response 201: { ... created step with nested data }
Response 400: "Engineering Master must be in draft state"
```

**PUT /:id** — Update step (master must be draft)
```
Request: { title: "...", instructions: "...", parts: [...], tooling: [...], markers: [...] }
Response 200: { ... updated step }
```

**DELETE /:id** — Delete step (master must be draft)
```
Response 200: { message: "Step deleted" }
```

**PUT /:id/reorder** — Change step number
```
Request: { stepNumber: 15 }
Response 200: { ... updated step }
```

**POST /:masterId/upload-image/:stepId** — Upload step background image
```
Request: multipart/form-data with image file
Response 200: { ... step with imageFileID set }
```

### Work Order API (`/api/manufacturing/work-order/`)

**GET /** — List all Work Orders
```
Query params: ?status=in_progress&masterId=1
Response 200:
[{
  id: 1,
  engineeringMasterID: 1,
  master: { id: 1, name: "PCB Assembly Process", revision: "A" },
  status: "in_progress",
  quantity: 5,
  completedSteps: 3,
  totalSteps: 5,
  createdByUserID: 1,
  createdAt: "...",
  updatedAt: "..."
}]
```

**GET /:id** — Get Work Order with step completion status
```
Response 200:
{
  id: 1,
  engineeringMasterID: 1,
  master: { ... full master with steps },
  status: "in_progress",
  quantity: 5,
  outputParts: [{ partID: 5, quantity: 5, part: { name: "PCB Assy" } }],
  stepCompletions: [
    { id: 1, stepID: 1, completedByUserID: 3, completedAt: "2026-04-07T...", user: { displayName: "John" } },
    { id: 2, stepID: 2, completedByUserID: 3, completedAt: "2026-04-07T...", user: { displayName: "John" } }
  ],
  createdByUserID: 1,
  createdAt: "...",
  updatedAt: "..."
}
```

**POST /** — Create Work Order
```
Request:
{
  engineeringMasterID: 1,
  quantity: 5
}
Response 201: { id: 1, status: "not_started", ... }
Response 400: "Engineering Master must be in released state"
```

**POST /:id/complete-step** — Mark step as complete
```
Request: { stepID: 3 }
Response 200: { ... step completion record }
Response 400: "Previous step must be completed first"
Response 400: "Step already completed"
```

**POST /:id/uncomplete-step** — Undo step completion (most recent only)
```
Request: { stepID: 3 }
Response 200: { message: "Step completion removed" }
Response 400: "Can only uncomplete the most recently completed step"
```

**POST /:id/complete** — Mark entire Work Order as complete
```
Response 200: { ... work order with status: "complete" }
Response 400: "All steps must be completed first"
```

**DELETE /:id** — Delete Work Order (only if not_started)
```
Response 200: { message: "Work Order deleted" }
Response 400: "Cannot delete a Work Order that has been started"
```

## Database Changes

### New Tables

**EngineeringMasters**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(255) | NOT NULL |
| description | TEXT | NULL |
| revision | STRING(8) | NOT NULL, default '01' |
| releaseState | ENUM('draft','review','released') | NOT NULL, default 'draft' |
| previousRevisionID | INTEGER | FK → EngineeringMasters.id, NULL |
| createdByUserID | INTEGER | FK → Users.id, NOT NULL |
| releasedByUserID | INTEGER | FK → Users.id, NULL |
| releasedAt | DATE | NULL |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

Indexes: `(name, revision)` unique, `activeFlag`, `releaseState`

**EngineeringMasterOutputParts**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| engineeringMasterID | INTEGER | FK → EngineeringMasters.id, NOT NULL, CASCADE |
| partID | INTEGER | FK → Parts.id, NOT NULL |
| quantity | DECIMAL(10,2) | NOT NULL, default 1 |
| createdAt | DATE | NOT NULL |

Indexes: `(engineeringMasterID, partID)` unique

**EngineeringMasterSteps**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| engineeringMasterID | INTEGER | FK → EngineeringMasters.id, NOT NULL, CASCADE |
| stepNumber | INTEGER | NOT NULL, default 10 |
| title | STRING(255) | NOT NULL |
| instructions | TEXT | NULL |
| imageFileID | INTEGER | FK → UploadedFiles.id, NULL |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

Indexes: `(engineeringMasterID, stepNumber)` unique

**EngineeringMasterStepItems**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| stepID | INTEGER | FK → EngineeringMasterSteps.id, NOT NULL, CASCADE |
| partID | INTEGER | FK → Parts.id, NOT NULL |
| quantity | DECIMAL(10,2) | NOT NULL, default 1 |
| isTool | BOOLEAN | NOT NULL, default false |
| createdAt | DATE | NOT NULL |

Indexes: `(stepID, partID)` unique

**EngineeringMasterStepMarkers**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| stepID | INTEGER | FK → EngineeringMasterSteps.id, NOT NULL, CASCADE |
| label | STRING(50) | NOT NULL |
| x | FLOAT | NOT NULL |
| y | FLOAT | NOT NULL |
| createdAt | DATE | NOT NULL |

**EngineeringMasterHistory**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| engineeringMasterID | INTEGER | FK → EngineeringMasters.id, NOT NULL |
| changeType | STRING(30) | NOT NULL (created, updated, submitted, rejected, released, new_revision) |
| changes | JSONB | NULL |
| snapshotData | JSONB | NULL |
| changedByUserID | INTEGER | FK → Users.id, NOT NULL |
| createdAt | DATE | NOT NULL |

**WorkOrders**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| engineeringMasterID | INTEGER | FK → EngineeringMasters.id, NOT NULL |
| status | ENUM('not_started','in_progress','complete') | NOT NULL, default 'not_started' |
| quantity | INTEGER | NOT NULL, default 1 |
| createdByUserID | INTEGER | FK → Users.id, NOT NULL |
| completedAt | DATE | NULL |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

Indexes: `status`, `engineeringMasterID`, `activeFlag`

**WorkOrderStepCompletions**
| Column | Type | Constraints |
|--------|------|------------|
| id | INTEGER | PK, auto-increment |
| workOrderID | INTEGER | FK → WorkOrders.id, NOT NULL, CASCADE |
| stepID | INTEGER | FK → EngineeringMasterSteps.id, NOT NULL |
| completedByUserID | INTEGER | FK → Users.id, NOT NULL |
| completedAt | DATE | NOT NULL |
| createdAt | DATE | NOT NULL |

Indexes: `(workOrderID, stepID)` unique

### New Permissions (seeded in migration)

| Resource | Action |
|----------|--------|
| manufacturing_planning | read |
| manufacturing_planning | write |
| manufacturing_planning | delete |
| manufacturing_execution | read |
| manufacturing_execution | write |
| manufacturing_execution | delete |

Total: 6 new permissions (29 existing + 6 = 35 total). Add to Admin group.

## UI Design

### Engineering Master List View (`/design/masters`)

- Material table with columns: Name, Revision, State (chip badge), Output Parts, Steps, Created, Actions
- State chips: draft (gray), review (amber), released (green)
- Search bar filtering by name/description
- "New Master" button (gated by `manufacturing_planning.write`)
- Click row → navigate to master editor

### Engineering Master Editor (`/design/masters/:id/edit`, `/design/masters/new`)

**Header section:**
- Name, description fields
- Revision badge (read-only)
- Release state badge
- Action buttons: Save, Submit for Review, Reject, Release, New Revision (context-dependent on state)

**Output Parts section:**
- Part autocomplete to add output parts with quantity
- Table: Part Name, Revision, Quantity, Remove button

**Steps section:**
- Vertical list of step cards, each showing step number and title
- "Add Step" button (inserts at next increment of 10)
- Drag to reorder (updates step numbers)
- Click step → opens step editor

### Step Editor (inline or dialog)

**Layout (three-panel):**
```
┌──────────────┬────────────────────────────────┐
│  PARTS &     │                                │
│  TOOLING     │      CANVAS                    │
│              │   (background image +           │
│  Parts:      │    pin markers)                │
│  - Cap 100nF │                                │
│    qty: 4    │       📍 C1                    │
│              │              📍 C2              │
│  Tooling:    │                                │
│  - Tweezers  │       📍 C3                    │
│    qty: 1    │              📍 C4              │
│              │                                │
├──────────────┴────────────────────────────────┤
│  INSTRUCTIONS                                  │
│  Place C1-C4 on the PCB per the reference...  │
└────────────────────────────────────────────────┘
```

- **Left sidebar** (~250px): Parts list with quantity, tooling list with quantity. Part autocomplete to add. Remove button per item.
- **Center canvas**: Background image upload/display. Click canvas to place pin markers. Drag markers to reposition. Click marker to edit label or delete.
- **Bottom bar** (~100px): Text area for step instructions. Step number and title fields.

### Work Order List View (`/build/work-orders`)

- Material table: ID, Master Name, Revision, Status (chip), Progress (N/M steps), Quantity, Created, Actions
- Status filter dropdown
- "New Work Order" button (gated by `manufacturing_execution.write`)
- Click row → navigate to work order execution view

### Work Order Execution View (`/build/work-orders/:id`)

**Header:** Master name, revision, work order ID, quantity, overall status badge

**Step navigator:** Horizontal stepper or vertical step list showing completion status per step

**Active step view (same three-panel layout as editor, but read-only):**
- Left sidebar: Parts and tooling list (read-only, checkable for operator reference)
- Center canvas: Background image with pin markers (non-draggable)
- Bottom bar: Instructions text (read-only)
- **"Mark Step Complete" button** — prominent action button
- **"Undo" button** — only on the most recently completed step

**Completion:** When all steps are marked complete, "Complete Work Order" button becomes available.

## Test Scenarios

### Backend (Jest)

1. CRUD Engineering Masters (create, read, update, delete)
2. Release workflow state transitions (draft→review→released, reject, guards)
3. Cannot edit released master
4. New revision from released master (copies steps, parts, markers)
5. Engineering Master history recording on all mutations
6. Step CRUD with step number management
7. Step parts/tooling/marker CRUD
8. Step image upload
9. Unique constraint on (name, revision)
10. Work Order CRUD
11. Work Order creation requires released master
12. Step completion — sequential enforcement
13. Step completion — records user and timestamp
14. Uncomplete step — only most recent
15. Complete work order — requires all steps done
16. Cannot delete started work order
17. Permission enforcement on all endpoints

### Frontend (Karma spec)

1. Engineering Master list view — renders table, search, state badges
2. Engineering Master editor — form fields, output parts, step list
3. Step editor — three-panel layout, parts/tooling lists, canvas, markers
4. Work Order list view — renders table, status filter
5. Work Order execution view — step navigator, completion buttons, read-only canvas

### E2E (Playwright)

1. Create Engineering Master → add steps → add parts/markers → submit → release
2. Create Work Order from released master → complete steps → complete work order
3. Permission enforcement — user without manufacturing_planning cannot access masters

## Implementation Notes

### Files to Create

**Backend:**
- `backend/models/manufacturing/engineeringMaster.js`
- `backend/models/manufacturing/engineeringMasterOutputPart.js`
- `backend/models/manufacturing/engineeringMasterStep.js`
- `backend/models/manufacturing/engineeringMasterStepItem.js`
- `backend/models/manufacturing/engineeringMasterStepMarker.js`
- `backend/models/manufacturing/engineeringMasterHistory.js`
- `backend/models/manufacturing/workOrder.js`
- `backend/models/manufacturing/workOrderStepCompletion.js`
- `backend/api/manufacturing/master/controller.js`
- `backend/api/manufacturing/master/routes.js`
- `backend/api/manufacturing/master-step/controller.js`
- `backend/api/manufacturing/master-step/routes.js`
- `backend/api/manufacturing/work-order/controller.js`
- `backend/api/manufacturing/work-order/routes.js`
- `backend/migrations/20260407000000-create-manufacturing-tables.js`
- `backend/tests/__tests__/manufacturing/engineering-master.test.js`
- `backend/tests/__tests__/manufacturing/work-order.test.js`

**Frontend:**
- `frontend/src/app/models/engineering-master.model.ts`
- `frontend/src/app/models/work-order.model.ts`
- `frontend/src/app/services/manufacturing.service.ts`
- `frontend/src/app/services/manufacturing.service.spec.ts`
- `frontend/src/app/components/design/master-list-view/master-list-view.ts` + `.html` + `.css` + `.spec.ts`
- `frontend/src/app/components/design/master-editor/master-editor.ts` + `.html` + `.css` + `.spec.ts`
- `frontend/src/app/components/design/step-editor/step-editor.ts` + `.html` + `.css` + `.spec.ts`
- `frontend/src/app/components/build/work-order-list-view/work-order-list-view.ts` + `.html` + `.css` + `.spec.ts`
- `frontend/src/app/components/build/work-order-view/work-order-view.ts` + `.html` + `.css` + `.spec.ts`

### Files to Modify

- `frontend/src/app/app.routes.ts` — add master and work order routes
- `frontend/src/app/components/common/nav/nav.component.ts` — add "Engineering Masters" under Design, "Work Orders" under Build
- `frontend/src/app/components/common/nav/nav.component.html` — nav entries
- `backend/tests/setup.js` — add manufacturing table cleanup and permission seeds for tests

### Patterns to Follow

- **Release workflow:** Same pattern as `backend/api/parts/harness/controller.js` (submit-review, reject, release, new-revision)
- **Revision control:** Same pattern as Part model (`revision`, `previousRevisionID`, self-referential FK)
- **History tracking:** Same pattern as `RequirementHistory` / `HarnessRevisionHistory`
- **Permission seeding:** Same pattern as `20260216000000-create-permission-tables.js` migration
- **Canvas/markers:** Simple HTML5 Canvas or positioned `<div>` overlays on an `<img>` — much simpler than harness canvas (no wires, blocks, or complex rendering)
- **Step numbering:** Default increment of 10 (10, 20, 30...) to allow insertions without renumbering
