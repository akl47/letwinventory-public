# Feature: Design Requirements

## Context
The design requirements system provides hierarchical requirement management with categories, project association, approval workflow, and immutable audit trail. Requirements decompose into parent-child hierarchies, belong to categories for organization, and require project association. The approval workflow tracks who approved each requirement. An immutable RequirementHistory table automatically records all mutations with field-level diffs. The frontend displays requirements in a tree table with a status filter and provides create/edit pages with inline history timeline.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 107 | Design requirement CRUD | Met |
| 108 | Hierarchical parent-child relationships | Met |
| 109 | Approval workflow (approve/unapprove) | Met |
| 110 | Tree table with expandable hierarchy | Met |
| 111 | Create/edit pages with form validation | Met |
| 112 | Project association (projectID required) | Met |
| 113 | Requirement categories lookup table | Met |
| 114 | Immutable audit trail (RequirementHistory) | Met |
| 115 | Auto-record history on all mutations | Met |
| 116 | History GET endpoint with user association | Met |
| 117 | Frontend history timeline on edit page | Met |

### Hierarchy (Req #108)
- `parentRequirementID` (nullable) self-referencing FK
- `belongsTo` parent, `hasMany` children
- GET endpoint includes parent and child associations
- Tree view builds from flat array with indentation by level

### Approval (Req #109)
- `PUT /:id/approve` sets `approved=true`, records `approvedByUserID` and `approvedAt`
- `PUT /:id/unapprove` clears approval
- History entry created for both operations

### Immutable History (Req #114, Req #115)
- `RequirementHistory` table: no update or delete operations
- Change types: created, updated, approved, unapproved, deleted
- Field-level diffs: `{field: {from, to}}` for tracked fields
- `create` logs initial values as `{field: {from: null, to: value}}`
- `update` logs only changed fields with from/to; no record if nothing changed
- Optional `changeNotes` on updates

### Status Filter
- 5-status AND-based multi-select: approved, unapproved, not_implemented, implemented, validated
- Tree traversal preserves children of filtered-out parents

## API Contracts

### Requirements — `/api/design/requirement/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/design/requirement` | Yes | requirements.read | List all (`?projectID=` filter) |
| GET | `/api/design/requirement/:id` | Yes | requirements.read | Get by ID with associations |
| POST | `/api/design/requirement` | Yes | requirements.write | Create requirement |
| PUT | `/api/design/requirement/:id` | Yes | requirements.write | Update requirement |
| DELETE | `/api/design/requirement/:id` | Yes | requirements.delete | Soft delete |
| PUT | `/api/design/requirement/:id/approve` | Yes | requirements.approve | Approve |
| PUT | `/api/design/requirement/:id/unapprove` | Yes | requirements.approve | Unapprove |
| GET | `/api/design/requirement/:id/history` | Yes | requirements.read | Get history (DESC, with user) |

### Requirement Categories — `/api/design/requirement-category/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/design/requirement-category` | Yes | requirements.read | List active categories |
| POST | `/api/design/requirement-category` | Yes | requirements.write | Create category |
| PUT | `/api/design/requirement-category/:id` | Yes | requirements.write | Update category |
| DELETE | `/api/design/requirement-category/:id` | Yes | requirements.delete | Soft delete |

## UI Design

### Requirements List (`/requirements`)
- **Tree table:** `mat-table` with flat data source from hierarchy
- **Indentation** by nesting level with expand/collapse toggle
- **Columns:** expand toggle, description (indented), project, category, owner, approved status, actions
- **Project filter** dropdown in toolbar
- **Status filter:** 5-status AND-based multi-select chips
- **Search** across fields
- **Navigate** on row click to edit page

### Requirement Edit Page (`/requirements/new`, `/requirements/:id/edit`)
- **Create mode:** form with required fields
- **Edit mode:** read-only view first with Edit button
- **Form fields:** Project (required), Category (optional dropdown with manage dialog), Description (required textarea), Rationale (required), Parameter, Parent Requirement dropdown, Verification (required), Validation (required)
- **Header buttons:** Back, Edit/Cancel, Save/Create, Delete, Approve/Unapprove
- **History section:** collapsible timeline below metadata
  - Each entry: change type icon/label, user display name, timestamp, change notes, field-level diffs

### Category Manage Dialog
- Opened from category dropdown on edit page
- List existing categories with edit/delete
- Add new category with name and description

## Database Changes

### DesignRequirements Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| description | TEXT | NOT NULL |
| rationale | TEXT | NOT NULL |
| parameter | TEXT | nullable |
| verification | TEXT | NOT NULL |
| validation | TEXT | NOT NULL |
| ownerUserID | INTEGER | FK → Users |
| projectID | INTEGER | FK → Projects, NOT NULL |
| categoryID | INTEGER | FK → RequirementCategories, nullable |
| parentRequirementID | INTEGER | FK → DesignRequirements (self-ref), nullable |
| approved | BOOLEAN | default false |
| approvedByUserID | INTEGER | FK → Users, nullable |
| approvedAt | DATE | nullable |
| implementationStatus | STRING(20) | NOT NULL, default 'not_implemented' |
| implementedByUserID | INTEGER | FK → Users, nullable |
| implementedAt | DATE | nullable |
| activeFlag | BOOLEAN | default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### RequirementCategories Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL, UNIQUE |
| description | TEXT | nullable |
| activeFlag | BOOLEAN | default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### RequirementHistory Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| requirementID | INTEGER | FK → DesignRequirements, CASCADE |
| changedByUserID | INTEGER | FK → Users, CASCADE |
| changeType | STRING(20) | NOT NULL (created/updated/approved/unapproved/deleted) |
| changes | JSONB | nullable (field-level diffs) |
| changeNotes | TEXT | nullable |
| createdAt | DATE | NOT NULL |
| **No updatedAt** | | Immutable |

### Relevant Migrations
- `20260112000000-initial.js` — DesignRequirements, RequirementCategories
- `20260215000001-create-requirement-history.js` — RequirementHistory table
- `20260215120003-add-approved-at.js` — approvedAt column
- `20260216200000-require-design-requirement-fields.js` — rationale, verification, validation NOT NULL
- `20260304000000-add-implementation-status.js` — implementationStatus, implementedByUserID, implementedAt

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/design/design-requirement.test.js` — CRUD, hierarchy, approval, projectID filter, 401/403/404
- `backend/tests/__tests__/design/requirement-category.test.js` — CRUD, duplicate name, missing name, soft delete
- `backend/tests/__tests__/design/requirement-history.test.js` — table creation, history on create/update/approve/unapprove/delete, field diffs, changeNotes, full lifecycle

### Frontend (Karma)
- `frontend/src/app/components/design/requirements-list-view/requirements-list-view.spec.ts` — tree building, filtering, navigation
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.spec.ts` — create/edit modes, form validation, save, approve
- `frontend/src/app/components/design/category-manage-dialog/category-manage-dialog.spec.ts` — CRUD operations

### E2E (Playwright)
- No dedicated E2E spec (covered by navigation tests)

## Implementation Notes

### Key Files
- `backend/api/design/requirement/controller.js` — requirement CRUD + approval + history
- `backend/api/design/requirement-category/controller.js` — category CRUD
- `backend/models/design/designRequirement.js` — DesignRequirement model
- `backend/models/design/requirementCategory.js` — RequirementCategory model
- `backend/models/design/requirementHistory.js` — RequirementHistory model (no update/delete)
- `frontend/src/app/components/design/requirements-list-view/` — tree table list
- `frontend/src/app/components/design/requirement-edit-page/` — create/edit page
- `frontend/src/app/components/design/category-manage-dialog/` — category management
- `scripts/req.js` — CLI for requirement management (create, update, delete, list, approve, history, categories)

### Patterns Followed
- Immutable history with field-level diffs (JSONB)
- Self-referencing FK for hierarchy
- `changedByUserID` FK ensures user attribution
- History auto-recorded in controller (not model hooks)
- Category management via dialog from edit page
- req.js CLI uses test-login with `claude@letwin.co`, JWT cached 55min in `/tmp`

### Edge Cases
- History records have no `updatedAt` — immutable by design
- `update` creates no history if nothing actually changed
- Tree view preserves children of filtered-out parents during status filtering
- Each category has exactly 1 root requirement; zero cross-category parent links
- ~30 categories, ~167 total requirements in production
