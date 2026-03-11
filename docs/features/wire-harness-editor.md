# Feature: Wire Harness Editor

## Context
The wire harness editor is a canvas-based schematic design tool for cable assemblies. It supports connectors, cables, components, sub-harness references, wire and mating connections with orthogonal routing, element grouping, undo/redo, and auto-save. The release workflow (Draft → Review → Released) enforces engineering change control — released harnesses are read-only and editing creates new revisions. Images are stripped from JSON before save and re-fetched from the parts database on load. Parts sync on load detects structural changes from the parts catalog.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 45 | Canvas-based harness editor | Met |
| 46 | Connector placement/rotation/flip | Met |
| 47 | Multi-wire cables | Met |
| 48 | Components with pin groups | Met |
| 49 | Wire connections with orthogonal routing | Met |
| 50 | Connector mating connections | Met |
| 51 | Wire termination types from WireEnd DB | Met |
| 52 | Sub-harness references | Met |
| 53 | Undo/redo (50 entries max) | Met |
| 54 | Auto-save with 1.5s debounce | Met |
| 55 | Element grouping/ungrouping | Met |
| 56 | Pan, zoom, grid, snap-to-grid | Met |
| 57 | Release workflow (Draft/Review/Released) | Met |
| 58 | Released harnesses read-only | Met |
| 59 | New revision on editing released harness | Met |
| 60 | Harness list with status chips | Met |
| 61 | Import/export as JSON | Met |
| 62 | Backend validation for structural integrity | Met |
| 63 | Image data stripping on save/export | Met |
| 64 | Parts sync on harness load | Met |
| 65 | Sub-harness image display and toggle | Met |
| 102 | Design lifecycle stages | Met |
| 103 | Design input capture | Met |
| 104 | Design output generation | Met |
| 105 | Design review gates | Met |
| 106 | Design change history | Met |

### Canvas Architecture (Req #45)
- HTML5 Canvas 2D rendering in `harness-canvas.ts`
- Data model: `HarnessData` with connectors, cables, components, connections, subHarnesses
- Mouse/touch interaction with hit testing
- Tools: select, pan, wire, node edit, connector add, cable add, component add

### Release Workflow (Req #57, Req #58, Req #59)
- States: `draft` → `review` → `released`
- Submit for review cascades to sub-harnesses
- Reject returns to draft with notes
- Released harnesses are fully read-only (all editing tools disabled)
- Editing a released harness creates new revision (A→B→...→Z→AA)

### Image Handling (Req #63, Req #64)
- `stripImageData()` removes base64 images before save/export
- `syncPartsFromDatabase()` re-fetches images from parts DB on load
- Structural changes (pinCount, type, etc.) presented in sync dialog
- Images always silently refreshed

## API Contracts

### Harnesses — `/api/parts/harness/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/parts/harness` | Yes | harness.read | List harnesses |
| GET | `/api/parts/harness/next-part-number` | Yes | harness.read | Get next auto-generated part number |
| GET | `/api/parts/harness/:id` | Yes | harness.read | Get harness with data |
| POST | `/api/parts/harness` | Yes | harness.write | Create harness |
| PUT | `/api/parts/harness/:id` | Yes | harness.write | Update harness (auto-creates revision if released) |
| DELETE | `/api/parts/harness/:id` | Yes | harness.delete | Soft delete |
| POST | `/api/parts/harness/:id/submit-review` | Yes | harness.write | Draft → Review (cascades sub-harnesses) |
| POST | `/api/parts/harness/:id/reject` | Yes | harness.write | Review → Draft with notes |
| POST | `/api/parts/harness/:id/release` | Yes | harness.write | Review → Released |
| GET | `/api/parts/harness/:id/history` | Yes | harness.read | Revision history entries |
| GET | `/api/parts/harness/:id/revisions` | Yes | harness.read | All revisions in family |
| POST | `/api/parts/harness/:id/revert/:historyId` | Yes | harness.write | Revert to snapshot |
| GET | `/api/parts/harness/:id/parents` | Yes | harness.read | Find parent harnesses |
| GET | `/api/parts/harness/sub-harness-data` | Yes | harness.read | Batch fetch `?ids=1,2,3` |
| POST | `/api/parts/harness/validate` | Yes | harness.read | Validate structural integrity |

### Connectors — `/api/parts/connector/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/parts/connector` | Yes | harness.read | List connectors |
| GET | `/api/parts/connector/pin-types` | Yes | harness.read | List pin types |
| GET | `/api/parts/connector/:id` | Yes | harness.read | Get by ID |
| GET | `/api/parts/connector/by-part/:partId` | Yes | harness.read | Get by part (includes Part.imageFile) |
| POST | `/api/parts/connector` | Yes | harness.write | Create connector |
| PUT | `/api/parts/connector/:id` | Yes | harness.write | Update connector |
| DELETE | `/api/parts/connector/:id` | Yes | harness.delete | Delete connector |

### Cables — `/api/parts/cable/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/parts/cable` | Yes | harness.read | List cables |
| GET | `/api/parts/cable/:id` | Yes | harness.read | Get by ID |
| GET | `/api/parts/cable/by-part/:partId` | Yes | harness.read | Get by part (includes Part.imageFile) |
| POST | `/api/parts/cable` | Yes | harness.write | Create cable |
| PUT | `/api/parts/cable/:id` | Yes | harness.write | Update cable |
| DELETE | `/api/parts/cable/:id` | Yes | harness.delete | Delete cable |

### Components — `/api/parts/component/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/parts/component` | Yes | harness.read | List components |
| GET | `/api/parts/component/:id` | Yes | harness.read | Get by ID |
| GET | `/api/parts/component/by-part/:partId` | Yes | harness.read | Get by part (includes Part.imageFile) |
| POST | `/api/parts/component` | Yes | harness.write | Create component |
| PUT | `/api/parts/component/:id` | Yes | harness.write | Update component |
| DELETE | `/api/parts/component/:id` | Yes | harness.delete | Delete component |

### Wire Ends — `/api/parts/wire-end/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/parts/wire-end` | Yes | harness.read | List wire ends |
| GET | `/api/parts/wire-end/by-code/:code` | Yes | harness.read | Get by code |
| GET | `/api/parts/wire-end/:id` | Yes | harness.read | Get by ID |
| POST | `/api/parts/wire-end` | Yes | harness.write | Create wire end |
| PUT | `/api/parts/wire-end/:id` | Yes | harness.write | Update wire end |
| DELETE | `/api/parts/wire-end/:id` | Yes | harness.delete | Delete wire end |

## UI Design

### Harness List (`/harness`)
- **Columns:** name, part number, description, revision, release state (color chip), updated, actions
- **Status chips:** draft (gray #424242), review (orange #f57c00), released (green #388e3c)
- **Search, sort, pagination, URL sync**
- **Middle-click:** opens editor in new tab

### Harness Editor (`/harness/editor`, `/harness/editor/:id`)
- **Canvas:** HTML5 Canvas with pan/zoom, grid toggle, snap-to-grid
- **Toolbar:** tool selection (select, pan, wire, node edit), add elements, undo/redo, zoom controls, export/import
- **Property panel:** selected element properties (editable when not locked)
- **Release controls:** Submit Review, Reject, Release, New Revision buttons
- **View-only mode:** when lacking `harness.write` permission — "View Only" badge
- **Locked state:** released or in-review harnesses disable all editing
- **Auto-save:** 1.5s debounce on any data change

### Dialogs
- **Connector dialog:** label, type (male/female/terminal/splice), pin count, part selection, color
- **Cable dialog:** label, wire count, gauge, wire colors, part selection
- **Component dialog:** label, pin groups, part selection
- **Import dialog:** JSON paste/file upload, validation, sample data
- **Sync dialog:** shows structural changes from parts DB, accept/reject per change
- **Add part dialog:** search and select part to link
- **List dialog:** select harness for sub-harness reference

## Database Changes

### WireHarnesses Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(100) | NOT NULL |
| partID | INTEGER | FK → Parts, nullable |
| revision | STRING(10) | NOT NULL, default 'A' |
| description | TEXT | nullable |
| harnessData | JSONB | NOT NULL, default {} |
| thumbnailBase64 | TEXT | nullable |
| releaseState | STRING(20) | NOT NULL, default 'draft' |
| releasedAt | DATE | nullable |
| releasedBy | STRING(100) | nullable |
| previousRevisionID | INTEGER | FK → WireHarnesses (self-reference), nullable |
| createdBy | STRING(100) | nullable |
| activeFlag | BOOLEAN | NOT NULL, default true |

### HarnessRevisionHistory Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| harnessID | INTEGER | FK → WireHarnesses |
| changeType | STRING | NOT NULL |
| changedBy | STRING | NOT NULL |
| changedAt | DATE | NOT NULL |
| notes | TEXT | nullable |
| snapshotData | JSONB | nullable (full design state) |

### ElectricalConnectors Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| label | STRING(50) | NOT NULL |
| type | ENUM | male, female, terminal, splice |
| pinCount | INTEGER | NOT NULL |
| pins | JSONB | array of pin definitions |
| partID | INTEGER | FK → Parts, nullable |

### Cables Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| label | STRING(50) | NOT NULL |
| wireCount | INTEGER | NOT NULL |
| gaugeAWG | STRING | nullable |
| wires | JSONB | array of {id, color, colorCode} |
| partID | INTEGER | FK → Parts, nullable |

### ElectricalComponents Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| label | STRING(50) | NOT NULL |
| pinCount | INTEGER | NOT NULL |
| pins | JSONB | array of pin groups with pins |
| partID | INTEGER | FK → Parts, nullable |

### WireEnds Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| code | STRING(20) | NOT NULL, UNIQUE |
| name | STRING(50) | NOT NULL |
| description | TEXT | nullable |

Seeded: f-pin, m-pin, f-spade, m-spade, ring, fork, ferrule, soldered, bare

### Relevant Migrations
- `20260112000000-initial.js` — WireHarnesses, HarnessRevisionHistory, ElectricalConnectors, Cables, ElectricalComponents, WireEnds, Wires

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/parts/harness.test.js` — list, get, create, update, delete, next part number, submit-review, reject, release, history, revisions
- `backend/tests/__tests__/parts/connector.test.js` — list, pin types, get by ID/part, create, update, delete
- `backend/tests/__tests__/parts/cable.test.js` — list, get by ID/part, create, update, delete
- `backend/tests/__tests__/parts/component.test.js` — list, get by ID/part, create, update, delete
- `backend/tests/__tests__/parts/wireEnd.test.js` — list, by code, by ID, create, update, delete
- `backend/tests/__tests__/parts/wire.test.js` — wire operations

### Frontend (Karma)
- `frontend/src/app/components/harness/harness-page/harness-page.spec.ts` — initial state, computed properties, create, tool changes, copy/paste, undo/redo, export, load
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.spec.ts` — inputs, zoom, add elements, delete guards, group/ungroup
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.spec.ts` — connection updates, endpoint descriptions, wire ends, terminations
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.spec.ts` — tool selection, isReleased binding
- `frontend/src/app/components/harness/harness-connector-dialog/harness-connector-dialog.spec.ts` — create/edit, part selection, duplicate detection
- `frontend/src/app/components/harness/harness-add-cable-dialog/harness-add-cable-dialog.spec.ts` — create/edit, wire reorder
- `frontend/src/app/components/harness/harness-component-dialog/harness-component-dialog.spec.ts` — create/edit, pin groups
- `frontend/src/app/components/harness/harness-cable-dialog/harness-cable-dialog.spec.ts` — cable management
- `frontend/src/app/components/harness/harness-import-dialog/harness-import-dialog.spec.ts` — JSON import, validation
- `frontend/src/app/components/harness/harness-sync-dialog/harness-sync-dialog.spec.ts` — change detection, accept/reject
- `frontend/src/app/components/harness/harness-list-view/harness-list-view.spec.ts` — data loading, search, sorting, pagination
- `frontend/src/app/components/harness/harness-list-dialog/harness-list-dialog.spec.ts` — sub-harness selection
- `frontend/src/app/components/harness/harness-add-part-dialog/harness-add-part-dialog.spec.ts` — part search/select
- `frontend/src/app/services/harness.service.spec.ts` — API service
- `frontend/src/app/services/harness-history.service.spec.ts` — undo/redo stacks

### E2E (Playwright)
- `frontend/e2e/harness.spec.ts` — harness editor flows

## Implementation Notes

### Key Files
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts` — Canvas rendering, mouse/touch interaction
- `frontend/src/app/components/harness/harness-page/harness-page.ts` — Editor page orchestration
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts` — Property editing
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.ts` — Tool selection
- `frontend/src/app/models/harness.model.ts` — HarnessData type definitions
- `frontend/src/app/services/harness.service.ts` — API calls
- `frontend/src/app/services/harness-history.service.ts` — Undo/redo (max 50)
- `backend/api/parts/harness/controller.js` — Harness CRUD + release workflow
- `backend/models/parts/WireHarness.js` — WireHarness model
- `backend/models/parts/HarnessRevisionHistory.js` — History model

### Patterns Followed
- Revision letters: A→B→...→Z→AA→AB
- `stripImageData()` removes base64 before save/export
- `syncPartsFromDatabase()` re-fetches images on load
- `by-part` endpoints include nested `Part.imageFile` for fallback
- Wire routing: `calculateOrthogonalPathV2()` with lead-out direction and obstacle avoidance
- `WireDrawingManager` class (Phase 1 — created but not fully integrated)
- Endpoint resolution via `endpoint-resolver.ts`
- `isViewOnly` computed from `!hasPermission('harness', 'write')`, extends `isLocked`
- Sub-harness image toggle state is cache-only (not persisted)
- Connector pin sides: always wire=left (circle), mating=right (square)
- Vertical wire labels always read top-to-bottom

### Edge Cases
- Cycle detection: `wouldCreateCycle()` prevents circular sub-harness references
- Delete protection: cannot delete harness used as sub-harness
- Mating connections validated as between two connectors only
- Released harness edits auto-create new revision with previousRevisionID link
- Sub-harness cascade on submit-review
- Images stripped from JSON means harnessData JSONB column stays lean
