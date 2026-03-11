# Feature: Barcode System

## Context
Barcodes are the identity system for all physical inventory items. Every Location, Box, Trace, and Equipment receives a unique auto-generated barcode in PREFIX-XXXXXX hex format. The barcode system provides lookup, tag resolution, movement between locations, ZPL label generation and printing, and a complete audit trail of all barcode actions. Barcode history is the foundation of regulatory traceability per 21 CFR 820.60 and ISO 13485:2016 §7.5.3.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 21 | Auto-generate unique barcodes (PREFIX-XXXXXX) | Met |
| 22 | Barcode lookup by string | Met |
| 23 | Move barcodes between locations | Met |
| 24 | Barcode action history | Met |
| 25 | ZPL label generation (3x1, 1.5x1) | Met |
| 26 | Print to Zebra printers via TCP/WebSocket | Met |
| 27 | WebSocket print agent | Met |
| 28 | Barcode tag system | Met |
| 30 | Independent preview and print size selection | Met |
| 149 | Printer configuration | Met |

### Barcode Generation (Req #21)
- Barcode format: `PREFIX-XXXXXX` (hex, e.g., `AKL-00A3F1`)
- Categories: AKL (parts/traces), LOC (locations), BOX (boxes), EQP (equipment)
- Generated via PostgreSQL sequence in `beforeValidate` hook
- Immutable once assigned

### Barcode History (Req #24)
- Action types: CREATED, MOVED, RECEIVED, SPLIT, MERGED, DELETED
- Each record includes: barcodeID, userID, actionID, fromID, toID, serialNumber, lotNumber, qty, unitOfMeasureID
- Immutable (insert-only)
- Complete chain reconstructs full item history

### Label Printing (Req #25, Req #26)
- ZPL generation with QR code, company branding, item name, description, quantity
- Two sizes: 3"x1" (default) and 1.5"x1"
- Preview via Labelary API rendering
- Print via direct TCP (port 9100) or WebSocket print agent
- Print agent authenticates with `PRINT_AGENT_API_KEY`

## API Contracts

### Barcodes — `/api/inventory/barcode/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/barcode` | Yes | inventory.read | List all barcodes |
| GET | `/api/inventory/barcode/categories` | Yes | inventory.read | List barcode categories |
| GET | `/api/inventory/barcode/lookup/:barcode` | Yes | inventory.read | Lookup by barcode string |
| GET | `/api/inventory/barcode/display/:id` | Yes | inventory.read | Get ZPL label (`?labelSize=3x1`) |
| POST | `/api/inventory/barcode/print/:id` | Yes | inventory.write | Print label `{labelSize, printerIP}` |
| POST | `/api/inventory/barcode/move/:id` | Yes | inventory.write | Move barcode `{newLocationID}` |
| GET | `/api/inventory/barcode/tag/:id` | Yes | inventory.read | Get tag (type, name, description) |
| GET | `/api/inventory/barcode/tag/chain/:id` | Yes | inventory.read | Get parent chain to root |
| GET | `/api/inventory/barcode/tag/` | Yes | inventory.read | Get all tags |

### Barcode History — `/api/inventory/barcodehistory/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/barcodehistory` | Yes | inventory.read | List all history |
| GET | `/api/inventory/barcodehistory/actiontypes` | Yes | inventory.read | List action types |
| GET | `/api/inventory/barcodehistory/barcode/:barcodeId` | Yes | inventory.read | History for specific barcode |

## UI Design

### Barcode History Page (`/inventory/barcode-history/:id`)
- **Timeline view** of all actions for a specific barcode
- **Columns:** date, action (with icon), user, from/to locations, quantity, serial/lot
- **Search:** by action, user, barcode string
- **Sorting:** by date (default: newest first)
- **Barcode resolution:** displays barcode strings instead of raw IDs

### Barcode Dialog (opened from inventory tree)
- **Preview:** ZPL label rendered via Labelary API
- **Preview size dropdown:** 3x1 or 1.5x1 (re-fetches ZPL on change)
- **Print options:** collapsible section, hidden by default
  - Print label size dropdown (independent from preview size)
  - Print button with two-step confirmation
- **Actions:** Move (opens movement dialog), History (navigates to history page)

### Barcode Movement Dialog
- **Move action:** destination barcode input, self-move prevention, execute via API
- **Merge action:** merge barcode input, validates same part
- **Split action:** quantity input, validates positive value
- **Trash action:** optional quantity, confirmation matching barcode or quantity

### Barcode Tag Component
- Inline display of barcode string with type badge
- Click opens barcode dialog

## Database Changes

### Barcodes Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| barcode | STRING | NOT NULL, UNIQUE |
| barcodeCategoryID | INTEGER | FK → BarcodeCategories |
| parentBarcodeID | INTEGER | FK → Barcodes (self-reference) |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### BarcodeCategories Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING | NOT NULL, UNIQUE |
| prefix | STRING | NOT NULL |

Seeded: AKL, LOC, BOX, EQP

### BarcodeHistory Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| barcodeID | INTEGER | FK → Barcodes |
| userID | INTEGER | FK → Users |
| actionID | INTEGER | FK → BarcodeHistoryActionTypes |
| fromID | INTEGER | nullable |
| toID | INTEGER | nullable |
| serialNumber | STRING | nullable |
| lotNumber | STRING | nullable |
| qty | FLOAT | nullable |
| unitOfMeasureID | INTEGER | FK → UnitOfMeasure, nullable |
| createdAt | DATE | NOT NULL |

### BarcodeHistoryActionTypes Table
Seeded: CREATED, MOVED, RECEIVED, SPLIT, MERGED, DELETED

### Printers Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING | NOT NULL |
| ipAddress | STRING | NOT NULL, UNIQUE |
| description | STRING | nullable |
| isDefault | BOOLEAN | default false |

### Relevant Migrations
- `20260112000000-initial.js` — Barcodes, BarcodeCategories, BarcodeHistory, BarcodeHistoryActionTypes
- `20260112000001-create-printers.js` — Printers table

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/inventory/barcode.test.js` — list, categories, location barcodes, lookup
- `backend/tests/__tests__/inventory/barcodeHistory.test.js` — list all, action types, by barcode
- `backend/tests/__tests__/config/printers.test.js` — printer config

### Frontend (Karma)
- `frontend/src/app/components/inventory/barcode-history/barcode-history.spec.ts` — route loading, barcode map, column switching, search, action labels
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.spec.ts` — ZPL fetch, preview, print, size toggle
- `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` — move, merge, split, trash actions
- `frontend/src/app/components/inventory/barcode-tag/barcode-tag.spec.ts` — input/output binding

### E2E (Playwright)
- `frontend/e2e/inventory.spec.ts` — barcode-related flows

## Implementation Notes

### Key Files
- `backend/api/inventory/barcode/controller.js` — barcode CRUD, lookup, ZPL, print, move, tags
- `backend/api/inventory/barcodehistory/controller.js` — history queries
- `backend/models/inventory/barcode.js` — Barcode model with beforeValidate hook
- `backend/models/inventory/barcodeHistory.js` — BarcodeHistory model
- `backend/services/printAgentService.js` — WebSocket print agent
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.ts` — barcode dialog
- `frontend/src/app/components/inventory/barcode-history/barcode-history.ts` — history page
- `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.ts` — actions dialog

### Patterns Followed
- PostgreSQL sequence for barcode generation (skipped in SQLite tests)
- Barcode history is insert-only (immutable audit trail)
- WebSocket print agent with heartbeat (60s) and stale threshold (2 min)
- Print jobs have 30s timeout
- ZPL generated from current database state (prevents stale labels)

### Edge Cases
- Barcode generation uses PostgreSQL sequences — not testable in SQLite
- Self-move prevention (cannot move barcode to its own location)
- Print agent falls back to direct TCP if WebSocket not connected
- Printer selection: 3x1 → 10.50.20.91, 1.5x1 → 10.50.20.92, or custom IP
